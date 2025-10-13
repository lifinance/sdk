import type { LiFiStep, RequestOptions, SignedLiFiStep } from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { request } from '../request.js'
import { isStep } from '../typeguards.js'

/**
 * Get the transaction data for a single step of a route
 * @param config - The SDK client configuration
 * @param step - The step object.
 * @param options - Request options
 * @returns The step populated with the transaction data.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getStepTransaction = async (
  config: SDKBaseConfig,
  step: LiFiStep | SignedLiFiStep,
  options?: RequestOptions
): Promise<LiFiStep> => {
  if (!isStep(step)) {
    // While the validation fails for some users we should not enforce it
    console.warn('SDK Validation: Invalid Step', step)
  }

  return await request<LiFiStep>(
    config,
    `${config.apiUrl}/advanced/stepTransaction`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(step),
      signal: options?.signal,
    }
  )
}
