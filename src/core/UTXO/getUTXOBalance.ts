import { ChainId, type Token, type TokenAmount } from '@lifi/types'
import type { SDKBaseConfig } from '../types.js'
import { getUTXOPublicClient } from './getUTXOPublicClient.js'

export const getUTXOBalance = async (
  config: SDKBaseConfig,
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
  const client = await getUTXOPublicClient(config, ChainId.BTC)
  const [balance, blockCount] = await Promise.all([
    client.getBalance({ address: walletAddress }),
    client.getBlockCount(),
  ])

  return tokens.map((token) => ({
    ...token,
    amount: balance,
    blockNumber: BigInt(blockCount),
  }))
}
