import type { LiFiStep } from '@lifi/types'
import { getTokenBalance } from '../actions/getTokenBalance.js'
import { BalanceError } from '../errors/errors.js'
import type { SDKClient } from '../types/core.js'
import { formatUnits } from '../utils/formatUnits.js'
import { sleep } from '../utils/sleep.js'

export const checkBalance = async (
  client: SDKClient,
  walletAddress: string,
  step: LiFiStep,
  depth = 0
): Promise<void> => {
  const token = await getTokenBalance(
    client,
    walletAddress,
    step.action.fromToken
  )
  if (token) {
    const currentBalance = token.amount ?? 0n
    const neededBalance = BigInt(step.action.fromAmount)

    if (currentBalance < neededBalance) {
      if (depth <= 3) {
        await sleep(200)
        await checkBalance(client, walletAddress, step, depth + 1)
      } else if (
        (neededBalance *
          BigInt((1 - (step.action.slippage ?? 0)) * 1_000_000_000)) /
          1_000_000_000n <=
        currentBalance
      ) {
        // adjust amount in slippage limits
        step.action.fromAmount = currentBalance.toString()
      } else {
        const needed = formatUnits(neededBalance, token.decimals)
        const current = formatUnits(currentBalance, token.decimals)
        let errorMessage = `Your ${token.symbol} balance is too low, you try to transfer ${needed} ${token.symbol}, but your wallet only holds ${current} ${token.symbol}. No funds have been sent.`

        if (currentBalance !== 0n) {
          errorMessage += `If the problem consists, please delete this transfer and start a new one with a maximum of ${current} ${token.symbol}.`
        }

        throw new BalanceError(
          'The balance is too low.',
          new Error(errorMessage)
        )
      }
    }
  }
}
