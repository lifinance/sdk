import type { Token, TokenAmount } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { getTokenBalancesByChain } from './getTokenBalancesByChain.js'

/**
 * Returns the balances of a specific token a wallet holds across all aggregated chains.
 * @param config - The SDK client configuration
 * @param walletAddress - A wallet address.
 * @param token - A Token object.
 * @returns An object containing the token and the amounts on different chains.
 * @throws {BaseError} Throws a ValidationError if parameters are invalid.
 */
export const getTokenBalance = async (
  client: SDKClient,
  walletAddress: string,
  token: Token
): Promise<TokenAmount | null> => {
  const tokensByChain = { [token.chainId]: [token] }
  const tokenAmountsByChain = await getTokenBalancesByChain(
    client,
    walletAddress,
    tokensByChain
  )
  const tokenAmounts = Object.values(tokenAmountsByChain).flat()
  return tokenAmounts.length ? tokenAmounts[0] : null
}
