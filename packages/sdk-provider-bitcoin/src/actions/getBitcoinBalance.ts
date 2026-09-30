import {
  ChainId,
  type SDKClient,
  type Token,
  type TokenAmount,
} from '@lifi/sdk'
import { getBitcoinPublicClient } from '../client/publicClient.js'

export const getBitcoinBalance = async (
  client: SDKClient,
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
  // The client reads Bitcoin only, so another chain's amount stays unknown, not zero.
  const isBitcoinToken = (token: Token): boolean =>
    token.chainId === ChainId.BTC
  if (!tokens.some(isBitcoinToken)) {
    return tokens.map((token) => ({ ...token }))
  }
  const bigmiClient = await getBitcoinPublicClient(client, ChainId.BTC)
  const [balance, blockCount] = await Promise.allSettled([
    bigmiClient.getBalance({ address: walletAddress }),
    bigmiClient.getBlockCount(),
  ])

  const blockNumber =
    blockCount.status === 'fulfilled' ? BigInt(blockCount.value) : 0n
  // A failed request sets no amount, so callers can tell an unknown balance
  // from a known zero.
  const amount = balance.status === 'fulfilled' ? { amount: balance.value } : {}

  return tokens.map((token) =>
    isBitcoinToken(token) ? { ...token, ...amount, blockNumber } : { ...token }
  )
}
