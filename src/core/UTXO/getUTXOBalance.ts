import type { ChainId, Token, TokenAmount } from '@lifi/types'

export const getUTXOBalance = async (
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

  return getUTXOBalanceDefault(chainId, tokens, walletAddress)
}

const getUTXOBalanceDefault = async (
  _chainId: ChainId,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  return []
}
