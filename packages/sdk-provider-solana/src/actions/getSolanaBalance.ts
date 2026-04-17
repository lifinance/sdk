import type { SDKClient } from '@lifi/sdk'
import {
  type ChainId,
  type Token,
  type TokenAmount,
  withDedupe,
} from '@lifi/sdk'
import { address, type JsonParsedTokenAccount } from '@solana/kit'

import { callSolanaRpcsWithRetry } from '../rpc/utils.js'

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
          callSolanaRpcsWithRetry(client, (rpc) =>
            rpc.getSlot({ commitment: 'confirmed' }).send()
          ),
        { id: `${getSolanaBalanceDefault.name}.getSlot` }
      ),
      withDedupe(
        () =>
          callSolanaRpcsWithRetry(client, (rpc) =>
            rpc.getBalance(accountAddress, { commitment: 'confirmed' }).send()
          ),
        { id: `${getSolanaBalanceDefault.name}.getBalance` }
      ),
      withDedupe(
        () =>
          callSolanaRpcsWithRetry(client, (rpc) =>
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
          callSolanaRpcsWithRetry(client, (rpc) =>
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
  const nativeBalanceOk = balance.status === 'fulfilled'
  const solBalance = nativeBalanceOk ? BigInt(balance.value.value) : 0n
  const tokenProgramOk = tokenAccountsByOwner.status === 'fulfilled'
  const token2022ProgramOk = token2022AccountsByOwner.status === 'fulfilled'

  const walletTokenAmounts = [
    ...(tokenProgramOk ? tokenAccountsByOwner.value.value : []),
    ...(token2022ProgramOk ? token2022AccountsByOwner.value.value : []),
  ].reduce(
    (tokenAmounts: Record<string, bigint>, value) => {
      const tokenAccount: JsonParsedTokenAccount =
        value.account.data.parsed.info
      const amount = BigInt(tokenAccount.tokenAmount.amount)
      if (amount > 0n) {
        tokenAmounts[tokenAccount.mint] = amount
      }
      return tokenAmounts
    },
    {} as Record<string, bigint>
  )

  // We can only confidently report 0n for an SPL mint when both Token and
  // Token2022 program queries succeeded — otherwise the mint may live in the
  // program whose query failed (e.g. PYUSD on Token2022).
  const splZeroIsKnown = tokenProgramOk && token2022ProgramOk

  const tokenAmounts: TokenAmount[] = tokens.map((token) => {
    const isNative = token.address === SolSystemProgram
    if (isNative) {
      if (!nativeBalanceOk) {
        return { ...token, blockNumber }
      }
      return { ...token, amount: solBalance, blockNumber }
    }
    const found = walletTokenAmounts[token.address]
    if (found !== undefined) {
      return { ...token, amount: found, blockNumber }
    }
    if (splZeroIsKnown) {
      return { ...token, amount: 0n, blockNumber }
    }
    return { ...token, blockNumber }
  })
  return tokenAmounts
}
