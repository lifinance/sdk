import type { Token, TokenAmount } from '@lifi/types'
import { withDedupe } from '../../utils/withDedupe.js'
import { callSuiWithRetry } from './suiClient.js'
import { SuiTokenLongAddress, SuiTokenShortAddress } from './types.js'

export async function getSuiBalance(
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> {
  if (tokens.length === 0) {
    return []
  }

  const { chainId } = tokens[0]
  for (const token of tokens) {
    if (token.chainId !== chainId) {
      console.warn('Requested tokens have to be on the same chain.')
    }
  }

  return getSuiBalanceDefault(chainId, tokens, walletAddress)
}

const getSuiBalanceDefault = async (
  _chainId: number,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  const [coins, checkpoint] = await Promise.allSettled([
    withDedupe(
      () =>
        callSuiWithRetry((client) =>
          client.getAllBalances({
            owner: walletAddress,
          })
        ),
      { id: `${getSuiBalanceDefault.name}.getAllBalances` }
    ),
    withDedupe(
      () =>
        callSuiWithRetry((client) =>
          client.getLatestCheckpointSequenceNumber()
        ),
      { id: `${getSuiBalanceDefault.name}.getLatestCheckpointSequenceNumber` }
    ),
  ])

  const coinsResult = coins.status === 'fulfilled' ? coins.value : []
  const blockNumber =
    checkpoint.status === 'fulfilled' ? BigInt(checkpoint.value) : 0n

  const walletTokenAmounts = coinsResult.reduce(
    (tokenAmounts, coin) => {
      const amount = BigInt(coin.totalBalance)
      if (amount > 0n) {
        tokenAmounts[coin.coinType] = amount
      }
      return tokenAmounts
    },
    {} as Record<string, bigint>
  )

  const suiTokenBalance = coinsResult.find(
    (coin) => coin.coinType === SuiTokenShortAddress
  )
  if (suiTokenBalance?.totalBalance) {
    walletTokenAmounts[SuiTokenLongAddress] = BigInt(
      suiTokenBalance.totalBalance
    )
  }

  const tokenAmounts: TokenAmount[] = tokens.map((token) => {
    if (walletTokenAmounts[token.address]) {
      return {
        ...token,
        amount: walletTokenAmounts[token.address],
        blockNumber,
      }
    }
    return {
      ...token,
      blockNumber,
    }
  })
  return tokenAmounts
}
