import type { ChainId, Token, TokenAmount } from '@lifi/types'
import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from './connection.js'

export const getSolanaBalance = async (
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]> => {
  if (tokens.length === 0) {
    return []
  }
  const { chainId } = tokens[0]
  tokens.forEach((token) => {
    if (token.chainId !== chainId) {
      console.warn(`Requested tokens have to be on the same chain.`)
    }
  })

  return getSolanaBalanceDefault(chainId, tokens, walletAddress)
}

const getSolanaBalanceDefault = async (
  _chainId: ChainId,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  const connection = await getSolanaConnection()
  const blockNumber = await connection.getSlot()
  const queue: Promise<bigint>[] = tokens.map(async (token) => {
    try {
      const accountPublicKey = new PublicKey(walletAddress)
      const tokenPublicKey = new PublicKey(token.address)
      const response = await connection.getParsedTokenAccountsByOwner(
        accountPublicKey,
        {
          mint: tokenPublicKey,
        }
      )
      return BigInt(
        response.value[0].account.data.parsed?.info?.tokenAmount?.amount || 0
      )
    } catch (error) {
      throw error
    }
  })

  const results = await Promise.allSettled(queue)

  const tokenAmounts: TokenAmount[] = tokens.map((token, index) => {
    const result = results[index]
    if (result.status === 'rejected') {
      return {
        ...token,
        blockNumber: BigInt(blockNumber),
      }
    }
    return {
      ...token,
      amount: result.value,
      blockNumber: BigInt(blockNumber),
    }
  })
  return tokenAmounts
}
