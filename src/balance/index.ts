import { Token, TokenAmount } from '@lifi/types'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { Step } from '..'
import { ValidationError } from '../utils/errors'
import utils from './utils'

export const getTokenBalance = async (
  walletAddress: string,
  token: Token
): Promise<TokenAmount | null> => {
  const tokenAmounts = await getTokenBalances(walletAddress, [token])
  return tokenAmounts.length ? tokenAmounts[0] : null
}

export const getTokenBalances = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  // split by chain
  const tokensByChain: { [chainId: number]: Token[] } = {}
  tokens.forEach((token) => {
    if (!tokensByChain[token.chainId]) {
      tokensByChain[token.chainId] = []
    }
    tokensByChain[token.chainId].push(token)
  })

  const tokenAmountsByChain = await getTokenBalancesForChains(
    walletAddress,
    tokensByChain
  )
  return Object.values(tokenAmountsByChain).flat()
}

export const getTokenBalancesForChains = async (
  walletAddress: string,
  tokensByChain: { [chainId: number]: Token[] }
): Promise<{ [chainId: number]: TokenAmount[] }> => {
  const tokenAmountsByChain: { [chainId: number]: TokenAmount[] } = {}
  const promises = Object.keys(tokensByChain).map(async (chainIdStr) => {
    const chainId = parseInt(chainIdStr)
    const tokenAmounts = await utils.getBalances(
      walletAddress,
      tokensByChain[chainId]
    )
    tokenAmountsByChain[chainId] = tokenAmounts
  })

  await Promise.allSettled(promises)
  return tokenAmountsByChain
}

export const checkBalance = async (
  signer: ethers.Signer,
  step: Step
): Promise<void> => {
  const tokenAmount = await getTokenBalance(
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

        throw new ValidationError('The balance is too low.', errorMessage)
      }
    }
  }
}
