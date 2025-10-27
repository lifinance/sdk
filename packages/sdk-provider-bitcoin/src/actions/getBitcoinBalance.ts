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
  const bigmiClient = await getBitcoinPublicClient(client, ChainId.BTC)
  const [balance, blockCount] = await Promise.all([
    bigmiClient.getBalance({ address: walletAddress }),
    bigmiClient.getBlockCount(),
  ])

  return tokens.map((token) => ({
    ...token,
    amount: balance,
    blockNumber: BigInt(blockCount),
  }))
}
