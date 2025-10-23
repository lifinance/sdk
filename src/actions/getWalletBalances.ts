import type {
  GetWalletBalanceExtendedResponse,
  RequestOptions,
  WalletTokenExtended,
} from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { request } from '../request.js'
import type { SDKClient } from '../types/core.js'

/**
 * Returns the balances of tokens a wallet holds across EVM chains.
 * @param client - The SDK client.
 * @param walletAddress - A wallet address.
 * @param options - Optional request options.
 * @returns An object containing the tokens and the amounts organized by chain ids.
 * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
 */
export const getWalletBalances = async (
  client: SDKClient,
  walletAddress: string,
  options?: RequestOptions
): Promise<Record<number, WalletTokenExtended[]>> => {
  if (!walletAddress) {
    throw new ValidationError('Missing walletAddress.')
  }

  const response = await request<GetWalletBalanceExtendedResponse>(
    client.config,
    `${client.config.apiUrl}/wallets/${walletAddress}/balances?extended=true`,
    {
      signal: options?.signal,
    }
  )

  return (response?.balances || {}) as Record<number, WalletTokenExtended[]>
}
