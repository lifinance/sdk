import type { Token, TokenAmount } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { getTokenBalances } from './getTokenBalances.js'

/**
 * Returns the balances of a specific token a wallet holds across all aggregated chains.
 * @param client - The SDK client.
 * @param walletAddress - A wallet address.
 * @param token - A Token object.
 * @returns An object containing the token and the amounts on different chains.
 * @throws {ValidationError} Throws a ValidationError if validation fails.
 * @throws {Error} Throws an Error if the SDK Provider for the wallet address is not found.
 */
export const getTokenBalance = async (
  client: SDKClient,
  walletAddress: string,
  token: Token
): Promise<TokenAmount | null> => {
  const tokenAmounts = await getTokenBalances(client, walletAddress, [token])
  return tokenAmounts.length ? tokenAmounts[0] : null
}
