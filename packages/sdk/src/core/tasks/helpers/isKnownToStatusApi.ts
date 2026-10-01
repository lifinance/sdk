import type { LiFiStep } from '@lifi/types'
import { getStatus } from '../../../actions/getStatus.js'
import type { SDKClient } from '../../../types/core.js'
import { getStepStatusRequest } from './getStepStatusRequest.js'

/** The status API gets this long before its silence counts as a miss. */
const STATUS_API_TIMEOUT_MS = 10_000

/**
 * The status-API veto of the "dropped" rule. True only when the API answers
 * with a status other than NOT_FOUND: the transaction then exists and is never
 * dropped. The API answers HTTP 404 for unknown hashes and also for landed
 * transactions it does not index, so a miss or an error says nothing and only
 * a chain node whose history covers the signing time can prove absence.
 *
 * No answer within `STATUS_API_TIMEOUT_MS` is a miss too, so a hung API cannot
 * stop the wait task at its final verdict. The timer aborts the request and
 * also settles the call, in case a request interceptor dropped the signal.
 * Not `AbortSignal.timeout`: a published SDK should not raise its runtime
 * floor for it; one controller and one timer cover it.
 */
export async function isKnownToStatusApi(
  client: SDKClient,
  step: LiFiStep,
  txHash: string
): Promise<boolean> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `The status API did not answer within ${STATUS_API_TIMEOUT_MS}ms.`
      )
      controller.abort(error)
      reject(error)
    }, STATUS_API_TIMEOUT_MS)
    // A pending timer keeps Node's event loop alive. The `finally` clears it;
    // the unref only covers a path that skips it.
    const handle = timer as unknown as { unref?: () => void }
    handle.unref?.()
  })
  try {
    const response = await Promise.race([
      getStatus(client, getStepStatusRequest(step, txHash), {
        signal: controller.signal,
      }),
      timeout,
    ])
    return response.status !== 'NOT_FOUND'
  } catch (_) {
    return false
  } finally {
    clearTimeout(timer)
  }
}
