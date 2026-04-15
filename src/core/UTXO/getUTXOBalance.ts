import { ChainId, type Token, type TokenAmount } from '@lifi/types'
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
  const client = await getUTXOPublicClient(ChainId.BTC)
  const [balance, blockCount] = await Promise.allSettled([
    client.getBalance({ address: walletAddress }),
    client.getBlockCount(),
  ])

  const blockNumber =
    blockCount.status === 'fulfilled' ? BigInt(blockCount.value) : 0n

  if (balance.status !== 'fulfilled') {
    // RPC failed — leave amount undefined so callers can distinguish
    // an unknown balance from a known zero.
    return tokens.map((token) => ({
      ...token,
      blockNumber,
    }))
  }

  return tokens.map((token) => ({
    ...token,
    amount: balance.value,
    blockNumber,
  }))
}
