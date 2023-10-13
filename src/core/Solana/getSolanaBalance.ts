import type { ChainId, Token, TokenAmount } from '@lifi/types'
import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from './connection.js'
import { TokenProgramAddress } from './types.js'

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
  const accountPublicKey = new PublicKey(walletAddress)
  const tokenProgramPublicKey = new PublicKey(TokenProgramAddress)
  const response = await connection.getParsedTokenAccountsByOwner(
    accountPublicKey,
    {
      programId: tokenProgramPublicKey,
    }
  )
  const walletTokenAmounts = response.value.reduce(
    (tokenAmounts, value) => {
      const amount = BigInt(value.account.data.parsed.info.tokenAmount.amount)
      if (amount > 0n) {
        tokenAmounts[value.account.data.parsed.info.mint] = amount
      }
      return tokenAmounts
    },
    {} as Record<string, bigint>
  )
  const tokenAmounts: TokenAmount[] = tokens.map((token) => {
    if (walletTokenAmounts[token.address]) {
      return {
        ...token,
        amount: walletTokenAmounts[token.address],
        blockNumber: BigInt(blockNumber),
      }
    }
    return {
      ...token,
      blockNumber: BigInt(blockNumber),
    }
  })
  return tokenAmounts
}
