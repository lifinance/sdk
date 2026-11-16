import type { LiFiStep, RequestOptions } from '@lifi/types'
import { BaseError } from '../errors/baseError.js'
import { ErrorName, LiFiErrorCode } from '../errors/constants.js'
import { SDKError } from '../errors/SDKError.js'
import type { QuoteRequestFromAmount } from '../types/actions.js'
import type { SDKClient } from '../types/core.js'

/**
 * Get a relayer quote for a token transfer. The legacy gasless relayer service
 * behind it is shut down, so this always rejects and sends no request.
 *
 * Kept only so that published consumers that still import it keep building.
 * It stays `async`: callers such as `getRelayerQuote(...).catch(() => null)`
 * need a rejected promise, not a synchronous throw.
 * @param _client - The SDK client
 * @param _params - The configuration of the requested quote
 * @param _options - Request options
 * @throws {SDKError} - Always, with a `NotFound` cause.
 * @returns Never resolves with a quote.
 * @deprecated The legacy gasless relayer service is shut down. Request
 * gasless routes with `options.gasless: true` on `getRoutes`, or
 * `gasless: true` on `getQuote`, and detect them with `isGaslessStep`.
 */
export const getRelayerQuote = async (
  _client: SDKClient,
  _params: QuoteRequestFromAmount,
  _options?: RequestOptions
): Promise<LiFiStep> => {
  throw new SDKError(
    new BaseError(
      ErrorName.NotFoundError,
      LiFiErrorCode.NotFound,
      'The legacy gasless relayer service is shut down. Request gasless routes with `options.gasless: true` on `getRoutes`.'
    )
  )
}
