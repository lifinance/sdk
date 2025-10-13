import type {
  Token,
  TokenAmount,
  TokenAmountExtended,
  TokenExtended,
} from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { getTokenBalancesByChain } from './getTokenBalancesByChain.js'

/**
 * Returns the balances for a list tokens a wallet holds across all aggregated chains.
 * @param config - The SDK client configuration
 * @param walletAddress - A wallet address.
 * @param tokens - A list of Token (or TokenExtended) objects.
 * @returns A list of objects containing the tokens and the amounts on different chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export async function getTokenBalances(
  client: SDKClient,
  walletAddress: string,
  tokens: Token[]
): Promise<TokenAmount[]>
export async function getTokenBalances(
  client: SDKClient,
  walletAddress: string,
  tokens: TokenExtended[]
): Promise<TokenAmountExtended[]> {
  // split by chain
  const tokensByChain = tokens.reduce(
    (tokens, token) => {
      if (!tokens[token.chainId]) {
        tokens[token.chainId] = []
      }
      tokens[token.chainId].push(token)
      return tokens
    },
    {} as { [chainId: number]: Token[] | TokenExtended[] }
  )

  const tokenAmountsByChain = await getTokenBalancesByChain(
    client,
    walletAddress,
    tokensByChain
  )
  return Object.values(tokenAmountsByChain).flat() as
    | TokenAmount[]
    | TokenAmountExtended[]
}
