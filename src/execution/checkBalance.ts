import Big from 'big.js'
import { formatUnits } from 'viem'
import type { LifiStep } from '..'
import { getTokenBalance } from '../balance'
import { BalanceError } from '../utils/errors'

export const checkBalance = async (
  walletAddress: string,
  step: LifiStep,
  depth = 0
): Promise<void> => {
  const token = await getTokenBalance(walletAddress, step.action.fromToken)
  if (token) {
    const currentBalance = Big(token.amount?.toString() ?? 0)
    const neededBalance = Big(step.action.fromAmount)

    if (currentBalance.lt(neededBalance)) {
      if (depth <= 3) {
        await new Promise((resolve) => {
          setTimeout(resolve, 200)
        })
        await checkBalance(walletAddress, step, depth + 1)
      } else if (
        neededBalance.mul(1 - step.action.slippage).lte(currentBalance)
      ) {
        // adjust amount in slippage limits
        step.action.fromAmount = currentBalance.toFixed(0)
      } else {
        const neeeded = formatUnits(
          BigInt(neededBalance.toString()),
          token.decimals
        )
        const current = formatUnits(
          BigInt(currentBalance.toString()),
          token.decimals
        )
        let errorMessage =
          `Your ${token.symbol} balance is too low, ` +
          `you try to transfer ${neeeded} ${token.symbol}, ` +
          `but your wallet only holds ${current} ${token.symbol}. ` +
          `No funds have been sent.`

        if (!currentBalance.eq(0)) {
          errorMessage +=
            `If the problem consists, please delete this transfer and ` +
            `start a new one with a maximum of ${current} ${token.symbol}.`
        }

        throw new BalanceError('The balance is too low.', errorMessage)
      }
    }
  }
}
