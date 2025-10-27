import type { SDKClient } from '@lifi/sdk'
import {
  type ChainId,
  type Token,
  type TokenAmount,
  withDedupe,
} from '@lifi/sdk'
import { PublicKey } from '@solana/web3.js'
import { callSolanaWithRetry } from './connection.js'
import { SolSystemProgram } from './constants.js'
import { Token2022ProgramId, TokenProgramId } from './types.js'

export const getSolanaBalance = async (
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

  return getSolanaBalanceDefault(client, chainId, tokens, walletAddress)
}

const getSolanaBalanceDefault = async (
  client: SDKClient,
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
          callSolanaWithRetry(client, (connection) =>
            connection.getSlot('confirmed')
          ),
        { id: `${getSolanaBalanceDefault.name}.getSlot` }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry(client, (connection) =>
            connection.getBalance(accountPublicKey, 'confirmed')
          ),
        { id: `${getSolanaBalanceDefault.name}.getBalance` }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry(client, (connection) =>
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
          callSolanaWithRetry(client, (connection) =>
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
