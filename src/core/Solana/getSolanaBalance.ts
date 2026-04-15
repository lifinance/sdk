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
  const nativeBalanceOk = balance.status === 'fulfilled'
  const solBalance = nativeBalanceOk ? BigInt(balance.value) : 0n
  const tokenProgramOk = tokenAccountsByOwner.status === 'fulfilled'
  const token2022ProgramOk = token2022AccountsByOwner.status === 'fulfilled'

  const walletTokenAmounts = [
    ...(tokenProgramOk ? tokenAccountsByOwner.value.value : []),
    ...(token2022ProgramOk ? token2022AccountsByOwner.value.value : []),
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
