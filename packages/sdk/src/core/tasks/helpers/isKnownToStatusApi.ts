import type { LiFiStep } from '@lifi/types'
import { getStatus } from '../../../actions/getStatus.js'
import type { SDKClient } from '../../../types/core.js'
import { getStepStatusRequest } from './getStepStatusRequest.js'

/**
 * The status-API veto of the "dropped" rule. True only when the API answers
 * with a status other than NOT_FOUND: the transaction then exists and is never
 * dropped. The API answers HTTP 404 for unknown hashes and also for landed
 * transactions it does not index, so a miss or an error says nothing and only
 * a chain node whose history covers the signing time can prove absence.
 */
export async function isKnownToStatusApi(
  client: SDKClient,
  step: LiFiStep,
  txHash: string
): Promise<boolean> {
  try {
    const response = await getStatus(client, getStepStatusRequest(step, txHash))
    return response.status !== 'NOT_FOUND'
  } catch (_) {
    return false
  }
}
