import { ChainId, type Token, type TokenAmount } from '@lifi/types'
import { getUTXOAPIPublicClient } from './getUTXOAPIPublicClient.js'
import { getUTXOPublicClient } from './getUTXOPublicClient.js'

export const getUTXOBalance = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }
  const { chainId } = tokens[0]
  for (const token of tokens) {
    if (token.chainId !== chainId) {
      console.warn('Requested tokens have to be on the same chain.')
    }
  }
  const apiClient = await getUTXOAPIPublicClient(ChainId.BTC)
  const client = await getUTXOPublicClient(ChainId.BTC)
  const [balance, blockCount] = await Promise.all([
    apiClient.getBalance({ address: walletAddress }),
    client.getBlockCount(),
  ])

  return tokens.map((token) => ({
    ...token,
    amount: balance,
    blockNumber: BigInt(blockCount),
  }))
}
