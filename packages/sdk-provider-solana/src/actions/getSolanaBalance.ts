import type { SDKClient } from '@lifi/sdk'
import {
  type ChainId,
  type Token,
  type TokenAmount,
  withDedupe,
} from '@lifi/sdk'
import { address } from '@solana/kit'

import { callSolanaWithRetry } from '../client/connection.js'

const SolSystemProgram = '11111111111111111111111111111111'
const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

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
  // Convert addresses to Solana Kit's address type
  const accountAddress = address(walletAddress)
  const tokenProgramAddress = address(TokenProgramId)
  const token2022ProgramAddress = address(Token2022ProgramId)

  // Use Solana Kit's RPC API with the retry wrapper
  const [slot, balance, tokenAccountsByOwner, token2022AccountsByOwner] =
    await Promise.allSettled([
      withDedupe(
        () =>
          callSolanaWithRetry(client, (rpc) =>
            rpc.getSlot({ commitment: 'confirmed' }).send()
          ),
        { id: `${getSolanaBalanceDefault.name}.getSlot` }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry(client, (rpc) =>
            rpc.getBalance(accountAddress, { commitment: 'confirmed' }).send()
          ),
        { id: `${getSolanaBalanceDefault.name}.getBalance` }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry(client, (rpc) =>
            rpc
              .getTokenAccountsByOwner(
                accountAddress,
                {
                  programId: tokenProgramAddress,
                },
                {
                  commitment: 'confirmed',
                  encoding: 'jsonParsed',
                }
              )
              .send()
          ),
        {
          id: `${getSolanaBalanceDefault.name}.getTokenAccountsByOwner.${TokenProgramId}`,
        }
      ),
      withDedupe(
        () =>
          callSolanaWithRetry(client, (rpc) =>
            rpc
              .getTokenAccountsByOwner(
                accountAddress,
                {
                  programId: token2022ProgramAddress,
                },
                {
                  commitment: 'confirmed',
                  encoding: 'jsonParsed',
                }
              )
              .send()
          ),
        {
          id: `${getSolanaBalanceDefault.name}.getTokenAccountsByOwner.${Token2022ProgramId}`,
        }
      ),
    ])
  const blockNumber = slot.status === 'fulfilled' ? BigInt(slot.value) : 0n
  const solBalance =
    balance.status === 'fulfilled' ? BigInt(balance.value.value) : 0n

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
