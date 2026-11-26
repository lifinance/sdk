import type { LiFiStep, Token, TokenAmount } from '@lifi/types'
import { BalanceError } from '../../../errors/errors.js'
import type { SDKClient } from '../../../types/core.js'
import { formatUnits } from '../../../utils/formatUnits.js'
import { sleep } from '../../../utils/sleep.js'
import { withTimeout } from '../../../utils/withTimeout.js'

const MAX_ATTEMPTS = 6
// Exponential backoff: 150, 300, 600, 1200, 2400 → ≈4.65s of sleep total.
const BACKOFF_BASE_MS = 150
// Leaves room for one read through the next RPC URL: viem's fallback
// transport moves on only after its 10 s http timeout.
const OVERALL_TIMEOUT_MS = 15_000

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
   * `gasPart` is excluded from the sufficiency check.
   * Source amount and non-included fees (e.g. LZ `msg.value`) are still
   * verified. Defaults to `true` (strict, today's behavior).
   */
  walletPaysGas?: boolean
}

/**
 * Verifies that the wallet holds enough of every token required to execute
 * the step on its source chain — the source-token amount, any gas costs, and
 * any non-included fee costs. Reads all balances in one batched provider
 * call, and retries within a bounded budget to absorb transient RPC failures
 * and post-confirmation propagation lag.
 *
 * The check never changes the step. The slippage is the on-chain tolerance
 * of the swap; spending it here on a balance gap as well would let the user
 * receive up to twice the slippage less than quoted. A later step gets the
 * amount that really arrived from the previous step's status, and the
 * prepare task quotes it again.
 *
 * Reads retry with backoff for up to `OVERALL_TIMEOUT_MS` (15 s), and each
 * read races the time that is left. When the attempts or the time run out,
 * the check decides from the latest read in which every balance was known,
 * and throws BalanceError("The balance is too low.") with the real numbers.
 * It throws BalanceError("Could not read wallet balance.") only when no such
 * read succeeded, with the last read error as the cause. Without a good read
 * the step does not go on: a transaction for funds the wallet does not hold
 * can still be sent and fail on chain, which costs gas.
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

  const deadline = Date.now() + OVERALL_TIMEOUT_MS

  // The shortfall of the latest read in which every balance was known, and
  // the reason the latest other read failed. A read that is still pending
  // when the check settles is never awaited, so it cannot change the result.
  let lastShortfall: Shortfall | undefined
  let lastFailure: Error | undefined

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
        // This read cannot see every balance, but it can show that an
        // older shortfall is gone. Then do not report that shortfall.
        const isCovered = ({ req }: Shortfall[number]): boolean => {
          const have = balanceByAddress.get(req.token.address.toLowerCase())
          return have !== undefined && have >= need(req)
        }
        if (lastShortfall?.every(isCovered)) {
          lastShortfall = undefined
        }
      } else {
        lastShortfall = insufficient
      }
    }

    // Decide now rather than start a backoff that ends after the deadline.
    const backoff = BACKOFF_BASE_MS * 2 ** attempt
    if (attempt === MAX_ATTEMPTS - 1 || Date.now() + backoff >= deadline) {
      break
    }
    await sleep(backoff)
  }

  if (!lastShortfall) {
    throw new BalanceError('Could not read wallet balance.', lastFailure)
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
