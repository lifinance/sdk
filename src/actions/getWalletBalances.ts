import type {
  GetWalletBalanceExtendedResponse,
  RequestOptions,
  WalletTokenExtended,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { request } from '../request.js'

/**
 * Returns the balances of tokens a wallet holds across EVM chains.
 * @param config - The SDK client configuration.
 * @param walletAddress - A wallet address.
 * @param options - Optional request options.
 * @returns An object containing the tokens and the amounts organized by chain ids.
 * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
 */
export const getWalletBalances = async (
  config: SDKBaseConfig,
  walletAddress: string,
  options?: RequestOptions
): Promise<Record<number, WalletTokenExtended[]>> => {
  if (!walletAddress) {
    throw new ValidationError('Missing walletAddress.')
  }

  const response = await request<GetWalletBalanceExtendedResponse>(
    config,
    `${config.apiUrl}/wallets/${walletAddress}/balances?extended=true`,
    {
      signal: options?.signal,
    }
  )

  return (response?.balances || {}) as Record<number, WalletTokenExtended[]>
}
