import type { ChainId, Token, TokenAmount } from '@lifi/types'
import { PublicKey } from '@solana/web3.js'
import { SolSystemProgram } from '../../constants.js'
import { withDedupe } from '../../utils/withDedupe.js'
import { callSolanaWithRetry } from './connection.js'
import { Token2022ProgramId, TokenProgramId } from './types.js'

export const getSolanaBalance = async (
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

  return getSolanaBalanceDefault(chainId, tokens, walletAddress)
}

const getSolanaBalanceDefault = async (
  _chainId: ChainId,
  tokens: Token[],
  walletAddress: string
): Promise<TokenAmount[]> => {
  const accountPublicKey = new PublicKey(walletAddress)
  const tokenProgramIdPublicKey = new PublicKey(TokenProgramId)
  const token2022ProgramIdPublicKey = new PublicKey(Token2022ProgramId)
  const [slot, balance, tokenAccountsByOwner, token2022AccountsByOwner] =
    await Promise.allSettled([
      withDedupe(
        () =>
          callSolanaWithRetry((connection) => connection.getSlot('confirmed')),
        { id: `${getSolanaBalanceDefault.name}.getSlot` }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry((connection) =>
            connection.getBalance(accountPublicKey, 'confirmed')
          ),
        { id: `${getSolanaBalanceDefault.name}.getBalance` }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry((connection) =>
            connection.getParsedTokenAccountsByOwner(
              accountPublicKey,
              {
                programId: tokenProgramIdPublicKey,
              },
              'confirmed'
            )
          ),
        {
          id: `${getSolanaBalanceDefault.name}.getParsedTokenAccountsByOwner.${TokenProgramId}`,
        }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry((connection) =>
            connection.getParsedTokenAccountsByOwner(
              accountPublicKey,
              {
                programId: token2022ProgramIdPublicKey,
              },
              'confirmed'
            )
          ),
        {
          id: `${getSolanaBalanceDefault.name}.getParsedTokenAccountsByOwner.${Token2022ProgramId}`,
        }
      ),
    ])
  const blockNumber = slot.status === 'fulfilled' ? BigInt(slot.value) : 0n
  const solBalance = balance.status === 'fulfilled' ? BigInt(balance.value) : 0n

  const walletTokenAmounts = [
    ...(tokenAccountsByOwner.status === 'fulfilled'
      ? tokenAccountsByOwner.value.value
      : []),
    ...(token2022AccountsByOwner.status === 'fulfilled'
      ? token2022AccountsByOwner.value.value
      : []),
  ].reduce(
    (tokenAmounts: Record<string, bigint>, value: any) => {
      const amount = BigInt(value.account.data.parsed.info.tokenAmount.amount)
      if (amount > 0n) {
        tokenAmounts[value.account.data.parsed.info.mint] = amount
      }
      return tokenAmounts
    },
    {} as Record<string, bigint>
  )

  walletTokenAmounts[SolSystemProgram] = solBalance
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
