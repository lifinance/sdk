import type { LiFiStep, Token, TokenAmount } from '@lifi/types'
import { BalanceError } from '../../../errors/errors.js'
import type { SDKClient } from '../../../types/core.js'
import { formatUnits } from '../../../utils/formatUnits.js'
import { sleep } from '../../../utils/sleep.js'
import { withTimeout } from '../../../utils/withTimeout.js'

const MAX_ATTEMPTS = 6
// Exponential backoff: 150, 300, 600, 1200, 2400 → ≈4.65s of sleep total.
const BACKOFF_BASE_MS = 150
const OVERALL_TIMEOUT_MS = 10_000
const SLIPPAGE_PRECISION = 1_000_000_000n

type Requirement = {
  token: Token
  sourcePart: bigint // 0n for pure overhead tokens
  overheadPart: bigint // gas + non-included fees in this token
}

/**
 * Verifies that the wallet holds enough of every token required to execute
 * the step on its source chain — the source-token amount, any gas costs, and
 * any non-included fee costs. Reads all balances in one batched provider
 * call, retries within a bounded budget to absorb transient RPC failures and
 * post-confirmation propagation lag, and applies slippage to the source-token
 * portion only as a last resort (overhead is never trimmed).
 *
 * Throws BalanceError("The balance is too low.") on a genuine shortfall, or
 * BalanceError("Could not read wallet balance.") if the balance can't be read
 * after retries.
 */
export const checkBalance = async (
  client: SDKClient,
  walletAddress: string,
  step: LiFiStep
): Promise<void> => {
  const fromChainId = step.action.fromChainId
  const requirements = new Map<string, Requirement>()
  const add = (token: Token, amount: bigint, source: boolean): void => {
    if (token.chainId !== fromChainId || amount === 0n) {
      return
    }
    const key = token.address.toLowerCase()
    const req = requirements.get(key) ?? {
      token,
      sourcePart: 0n,
      overheadPart: 0n,
    }
    if (source) {
      req.sourcePart += amount
    } else {
      req.overheadPart += amount
    }
    requirements.set(key, req)
  }
  add(step.action.fromToken, BigInt(step.action.fromAmount), true)
  for (const gas of step.estimate?.gasCosts ?? []) {
    add(gas.token, BigInt(gas.amount), false)
  }
  for (const fee of step.estimate?.feeCosts ?? []) {
    // Included fees are already part of fromAmount — don't count twice.
    if (!fee.included) {
      add(fee.token, BigInt(fee.amount), false)
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
  const slippage = step.action.slippage ?? 0
  const slippageScaled = BigInt(
    Math.floor((1 - slippage) * Number(SLIPPAGE_PRECISION))
  )

  await withTimeout(
    async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const isFinal = attempt === MAX_ATTEMPTS - 1

        let balances: TokenAmount[]
        try {
          balances = await provider.getBalance(client, walletAddress, tokens)
        } catch (error) {
          if (isFinal) {
            throw new BalanceError(
              'Could not read wallet balance.',
              error as Error
            )
          }
          await sleep(BACKOFF_BASE_MS * 2 ** attempt)
          continue
        }

        const balanceByAddress = new Map(
          balances.map((b) => [b.address.toLowerCase(), b.amount] as const)
        )

        const unknown: Token[] = []
        const insufficient: { req: Requirement; have: bigint }[] = []
        for (const req of reqs) {
          const have = balanceByAddress.get(req.token.address.toLowerCase())
          if (have === undefined) {
            unknown.push(req.token)
          } else if (have < req.sourcePart + req.overheadPart) {
            insufficient.push({ req, have })
          }
        }

        if (unknown.length === 0 && insufficient.length === 0) {
          return
        }

        // Final-attempt slippage rescue: only when the sole shortfall is the
        // source-token portion. Trim source down to (balance − overhead) so
        // the overhead reserve is preserved.
        if (
          isFinal &&
          unknown.length === 0 &&
          insufficient.length === 1 &&
          insufficient[0].req.sourcePart > 0n
        ) {
          const { req, have } = insufficient[0]
          const minAcceptable =
            (req.sourcePart * slippageScaled) / SLIPPAGE_PRECISION +
            req.overheadPart
          if (have >= minAcceptable) {
            step.action.fromAmount = (have - req.overheadPart).toString()
            return
          }
        }

        if (isFinal) {
          if (unknown.length > 0) {
            throw new BalanceError(
              'Could not read wallet balance.',
              new Error(
                `Could not read balance for: ${unknown
                  .map((t) => t.symbol || t.address)
                  .join(', ')}.`
              )
            )
          }
          const lines = insufficient.map(({ req, have }) => {
            const needed = formatUnits(
              req.sourcePart + req.overheadPart,
              req.token.decimals
            )
            const current = formatUnits(have, req.token.decimals)
            const symbol = req.token.symbol
            return req.sourcePart > 0n
              ? `Your ${symbol} balance is too low, you try to transfer ${needed} ${symbol}, but your wallet only holds ${current} ${symbol}.`
              : `Insufficient ${symbol} for fees: need ${needed} ${symbol}, have ${current} ${symbol}.`
          })
          throw new BalanceError(
            'The balance is too low.',
            new Error(`${lines.join(' ')} No funds have been sent.`)
          )
        }

        await sleep(BACKOFF_BASE_MS * 2 ** attempt)
      }
    },
    {
      timeout: OVERALL_TIMEOUT_MS,
      errorInstance: new BalanceError('Could not read wallet balance.'),
    }
  )
}
