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
  // The client reads Bitcoin only. Another UTXO chain, such as ZEC, shares this
  // provider but not its balances, so its amount stays unknown, not zero.
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

  if (balance.status !== 'fulfilled') {
    // RPC failed — leave amount undefined so callers can distinguish
    // an unknown balance from a known zero.
    return tokens.map((token) => ({
      ...token,
      blockNumber,
    }))
  }

  return tokens.map((token) =>
    isBitcoinToken(token)
      ? { ...token, amount: balance.value, blockNumber }
      : { ...token }
  )
}
