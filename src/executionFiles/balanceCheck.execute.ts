import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { Step } from '..'
import balances from '../balances'

export const balanceCheck = async (signer: ethers.Signer, step: Step) => {
  const tokenAmount = await balances.getTokenBalance(
    await signer.getAddress(),
    step.action.fromToken
  )
  if (tokenAmount) {
    const currentBalance = new BigNumber(tokenAmount.amount).shiftedBy(
      tokenAmount.decimals
    )
    const neededBalance = new BigNumber(step.action.fromAmount)

    if (currentBalance.lt(neededBalance)) {
      if (
        neededBalance.multipliedBy(1 - step.action.slippage).lte(currentBalance)
      ) {
        // adjust amount in slippage limits
        step.action.fromAmount = currentBalance.toFixed(0)
      } else {
        const neeeded = neededBalance.shiftedBy(-tokenAmount.decimals).toFixed()
        const current = currentBalance
          .shiftedBy(-tokenAmount.decimals)
          .toFixed()
        let errorMessage =
          `Your ${tokenAmount.symbol} balance is too low, ` +
          `you try to transfer ${neeeded} ${tokenAmount.symbol}, ` +
          `but your wallet only holds ${current} ${tokenAmount.symbol}. ` +
          `No funds have been sent. `

        if (!currentBalance.isZero()) {
          errorMessage +=
            `If the problem consists, please delete this transfer and ` +
            `start a new one with a maximum of ${current} ${tokenAmount.symbol}.`
        }

        throw Error(errorMessage)
      }
    }
  }
}
