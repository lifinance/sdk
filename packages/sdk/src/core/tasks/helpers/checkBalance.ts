import type { LiFiStep, Token, TokenAmount } from '@lifi/types'
import { BalanceError } from '../../../errors/errors.js'
import type { SDKClient } from '../../../types/core.js'
import { formatUnits } from '../../../utils/formatUnits.js'
import { sleep } from '../../../utils/sleep.js'
import { withTimeout } from '../../../utils/withTimeout.js'
import { DEFAULT_SLIPPAGE_THRESHOLD } from '../../utils.js'

const MAX_ATTEMPTS = 6
// Exponential backoff: 150, 300, 600, 1200, 2400 → ≈4.65s of sleep total.
const BACKOFF_BASE_MS = 150
const OVERALL_TIMEOUT_MS = 15_000
const SLIPPAGE_PRECISION = 1_000_000_000n

type Bucket = 'source' | 'gas' | 'fee'

type Requirement = {
  token: Token
  sourcePart: bigint // step.action.fromAmount
  gasPart: bigint // step.estimate.gasCosts in this token
  feePart: bigint // non-included step.estimate.feeCosts in this token
}

type Shortfall = { req: Requirement; have: bigint }[]

export type CheckBalanceOptions = {
  /**
   * Set to `false` when outer-tx gas is paid by something other than
   * `walletAddress` (SCA executor, 4337 bundler / paymaster, relayer):
   * `gasPart` is excluded from the sufficiency check and slippage rescue.
   * Source amount and non-included fees (e.g. LZ `msg.value`) are still
   * verified. Defaults to `true` (strict, today's behavior).
   */
  walletPaysGas?: boolean
  /**
   * Set to `false` when something already signed for the exact source amount
   * (an EIP-2612 permit): a lower amount would not match the signature, so a
   * shortfall throws instead of trimming `fromAmount`. Defaults to `true`.
   */
  allowAmountTrim?: boolean
}

/**
 * Verifies that the wallet holds enough of every token required to execute
 * the step on its source chain — the source-token amount, any gas costs, and
 * any non-included fee costs. Reads all balances in one batched provider
 * call, retries within a bounded budget to absorb transient RPC failures and
 * post-confirmation propagation lag, and applies slippage to the source-token
 * portion only as a last resort (overhead is never trimmed).
 *
 * A step quoted on Auto slippage has no `action.slippage`. The rescue then
 * allows `DEFAULT_SLIPPAGE_THRESHOLD` (0.5%), the API's default. The fallback
 * is only used here; it is never written into the step.
 *
 * Reads retry with backoff for up to `OVERALL_TIMEOUT_MS` (15 s), and each
 * read races the time that is left. When the attempts or the time run out,
 * the check decides from the latest read in which every balance was known:
 * it rescues the source amount within slippage, or throws
 * BalanceError("The balance is too low.") with the real numbers. It throws
 * BalanceError("Could not read wallet balance.") only when no such read
 * succeeded, with the last read error as the cause.
 */
export const checkBalance = async (
  client: SDKClient,
  walletAddress: string,
  step: LiFiStep,
  options: CheckBalanceOptions = {}
): Promise<void> => {
  const fromChainId = step.action.fromChainId
  // Chains with non-standard native decimals (e.g. Tempo, Stable) report
  // gas costs in units that don't align with wallet balances — drop the
  // gas portion of the check on those chains.
  const fromChain = await client.getChainById(fromChainId)
  const walletPaysGas =
    (options.walletPaysGas ?? true) && !fromChain.nonStandardNativeDecimals
  const requirements = new Map<string, Requirement>()
  const add = (token: Token, amount: bigint, bucket: Bucket): void => {
    if (token.chainId !== fromChainId || amount === 0n) {
      return
    }
    const key = token.address.toLowerCase()
    const req = requirements.get(key) ?? {
      token,
      sourcePart: 0n,
      gasPart: 0n,
      feePart: 0n,
    }
    if (bucket === 'source') {
      req.sourcePart += amount
    } else if (bucket === 'gas') {
      req.gasPart += amount
    } else {
      req.feePart += amount
    }
    requirements.set(key, req)
  }
  add(step.action.fromToken, BigInt(step.action.fromAmount), 'source')
  for (const gas of step.estimate?.gasCosts ?? []) {
    add(gas.token, BigInt(gas.amount), 'gas')
  }
  for (const fee of step.estimate?.feeCosts ?? []) {
    // Included fees are already part of fromAmount — don't count twice.
    if (!fee.included) {
      add(fee.token, BigInt(fee.amount), 'fee')
    }
  }

  const reservedOverhead = (r: Requirement): bigint =>
    r.feePart + (walletPaysGas ? r.gasPart : 0n)
  const need = (r: Requirement): bigint => r.sourcePart + reservedOverhead(r)

  // Drop pure-gas entries when `walletPaysGas` is false (e.g. native ETH
  // on Safe Apps with only `gasPart`) — saves one balance read each.
  for (const [key, req] of requirements) {
    if (need(req) === 0n) {
      requirements.delete(key)
    }
  }

  if (requirements.size === 0) {
    return
  }

  // Provider is dispatched by wallet address; all requirements share the
  // source chain, which matches this provider by virtue of the address.
  const provider = client.providers.find((p) => p.isAddress(walletAddress))
  if (!provider) {
    throw new Error(`SDK Token Provider for ${walletAddress} is not found.`)
  }

  const reqs = Array.from(requirements.values())
  const tokens = reqs.map((r) => r.token)
  const rawSlippage = step.action.slippage ?? DEFAULT_SLIPPAGE_THRESHOLD
  // A slippage outside [0, 1) would let the rescue trim below the overhead
  // reserve, or down to dust at 1; a non-number would make `BigInt` throw.
  // Treat all of them as no slippage.
  const slippage =
    Number.isFinite(rawSlippage) && rawSlippage >= 0 && rawSlippage < 1
      ? rawSlippage
      : 0
  const slippageScaled = BigInt(
    Math.floor((1 - slippage) * Number(SLIPPAGE_PRECISION))
  )

  // Passed to every backoff sleep and aborted once the check settles, so no
  // sleep outlives the check.
  const controller = new AbortController()
  const { signal } = controller
  const deadline = Date.now() + OVERALL_TIMEOUT_MS

  // The shortfall of the latest read in which every balance was known, and
  // the reason the latest other read failed. A read that is still pending
  // when the check settles is never awaited, so it cannot change `step`.
  let lastShortfall: Shortfall | undefined
  let lastFailure: Error | undefined

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        break
      }

      let balances: TokenAmount[] | undefined
      try {
        balances = await withTimeout(
          () => provider.getBalance(client, walletAddress, tokens),
          {
            timeout: remaining,
            errorInstance: new Error('Balance read timed out.'),
          }
        )
      } catch (error) {
        lastFailure = error as Error
      }

      if (balances) {
        const balanceByAddress = new Map(
          balances.map((b) => [b.address.toLowerCase(), b.amount] as const)
        )
        const unknown: Token[] = []
        const insufficient: Shortfall = []
        for (const req of reqs) {
          const have = balanceByAddress.get(req.token.address.toLowerCase())
          if (have === undefined) {
            unknown.push(req.token)
          } else if (have < need(req)) {
            insufficient.push({ req, have })
          }
        }

        if (unknown.length === 0 && insufficient.length === 0) {
          return
        }
        if (unknown.length > 0) {
          lastFailure = new Error(
            `Could not read balance for: ${unknown
              .map((t) => t.symbol || t.address)
              .join(', ')}.`
          )
        } else {
          lastShortfall = insufficient
        }
      }

      // Decide now rather than start a backoff that ends after the deadline.
      const backoff = BACKOFF_BASE_MS * 2 ** attempt
      if (attempt === MAX_ATTEMPTS - 1 || Date.now() + backoff >= deadline) {
        break
      }
      await sleep(backoff, { signal })
    }
  } finally {
    controller.abort()
  }

  if (!lastShortfall) {
    throw new BalanceError('Could not read wallet balance.', lastFailure)
  }

  // Slippage rescue: only when the sole shortfall is the source-token
  // portion. Trim source to (balance − reserved overhead) so the overhead
  // reserve is preserved.
  if (
    options.allowAmountTrim !== false &&
    lastShortfall.length === 1 &&
    lastShortfall[0].req.sourcePart > 0n
  ) {
    const { req, have } = lastShortfall[0]
    const reserved = reservedOverhead(req)
    const minAcceptable =
      (req.sourcePart * slippageScaled) / SLIPPAGE_PRECISION + reserved
    if (have >= minAcceptable && have > reserved) {
      const newFromAmount = (have - reserved).toString()
      step.action.fromAmount = newFromAmount
      if (step.includedSteps?.length) {
        step.includedSteps[0].action.fromAmount = newFromAmount
      }
      // A quote carries a transaction request built for the old amount.
      // Drop it so the prepare task fetches one for the trimmed amount.
      step.transactionRequest = undefined
      return
    }
  }

  const lines = lastShortfall.map(({ req, have }) => {
    const needed = formatUnits(need(req), req.token.decimals)
    const current = formatUnits(have, req.token.decimals)
    const symbol = req.token.symbol
    // The "fees" branch covers pure-overhead tokens; with
    // walletPaysGas=false, gas is excluded from `need(req)` so it
    // only fires for genuine fee shortfalls.
    return req.sourcePart > 0n
      ? `Your ${symbol} balance is too low, you try to transfer ${needed} ${symbol}, but your wallet only holds ${current} ${symbol}.`
      : `Insufficient ${symbol} for fees: need ${needed} ${symbol}, have ${current} ${symbol}.`
  })
  throw new BalanceError(
    'The balance is too low.',
    new Error(`${lines.join(' ')} No funds have been sent.`)
  )
}
