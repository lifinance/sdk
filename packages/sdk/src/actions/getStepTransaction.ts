import type { LiFiStep, RequestOptions, SignedLiFiStep } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import { isStep } from '../utils/isStep.js'
import { request } from '../utils/request.js'

/**
 * Get the transaction data for a single step of a route
 * @param client - The SDK client
 * @param step - The step object.
 * @param options - Request options
 * @returns The step populated with the transaction data.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getStepTransaction = async (
  client: SDKClient,
  step: LiFiStep | SignedLiFiStep,
  options?: RequestOptions
): Promise<LiFiStep> => {
  if (!isStep(step)) {
    // While the validation fails for some users we should not enforce it
    console.warn('SDK Validation: Invalid Step', step)
  }

  return await request<LiFiStep>(
    client.config,
    `${client.config.apiUrl}/advanced/stepTransaction`,
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
