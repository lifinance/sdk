import type { FullStatusData, LiFiStep, StatusResponse } from '@lifi/types'
import { getStatus } from '../../../actions/getStatus.js'
import { ServerError } from '../../../errors/errors.js'
import type { ExecutionActionType, SDKClient } from '../../../types/core.js'
import { getAbortError } from '../../../utils/abort.js'
import { waitForResult } from '../../../utils/waitForResult.js'
import { getSubstatusMessage } from '../../actionMessages.js'
import type { StatusManager } from '../../StatusManager.js'
import { getStepStatusRequest } from './getStepStatusRequest.js'

type Waiter = {
  resolve: (status: StatusResponse) => void
  reject: (error: unknown) => void
}

/** The `/status` poll of one transaction hash, shared by all its callers. */
type StatusPoll = {
  promise: Promise<StatusResponse>
  controller: AbortController
  /** Callers with a signal that still wait, once the first one joined. */
  waiters?: Set<Waiter>
  /** A caller without a signal joined, so the poll runs until it settles. */
  pinned: boolean
}

/** @internal The running poll per transaction hash. Exported for tests. */
export const TRANSACTION_HASH_OBSERVERS: Partial<Record<string, StatusPoll>> =
  {}

/**
 * Waits for the final status of `txHash`. Callers that wait for the same hash
 * share one poll. A caller whose `signal` aborts leaves at once with the abort
 * reason; the poll itself ends only when every caller with a signal has left
 * and no caller without a signal joined it.
 */
export async function waitForTransactionStatus(
  client: SDKClient,
  statusManager: StatusManager,
  txHash: string,
  step: LiFiStep,
  actionType: ExecutionActionType,
  interval = 5_000,
  signal?: AbortSignal
): Promise<StatusResponse> {
  if (signal?.aborted) {
    throw getAbortError(signal)
  }

  const _getStatus = (
    pollSignal: AbortSignal
  ): Promise<StatusResponse | undefined> => {
    return getStatus(client, getStepStatusRequest(step, txHash), {
      signal: pollSignal,
    })
      .then((statusResponse) => {
        switch (statusResponse.status) {
          case 'DONE':
            return statusResponse
          case 'PENDING': {
            const pendingStatus = statusResponse as FullStatusData
            statusManager?.updateAction(step, actionType, 'PENDING', {
              substatus: statusResponse.substatus,
              substatusMessage:
                statusResponse.substatusMessage ||
                getSubstatusMessage(
                  statusResponse.status,
                  statusResponse.substatus
                ),
              // Most bridges implement no `getExplorerLink`, so fall back to
              // the LI.FI explorer rather than leave the user with no link.
              txLink:
                pendingStatus.bridgeExplorerLink ??
                pendingStatus.lifiExplorerLink,
            })
            return undefined
          }
          case 'NOT_FOUND':
            return undefined
          default:
            return Promise.reject()
        }
      })
      .catch((e) => {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Fetching status from backend failed.', e)
        }
        return undefined
      })
  }

  let poll = TRANSACTION_HASH_OBSERVERS[txHash]

  if (!poll) {
    const controller = new AbortController()
    const promise: Promise<StatusResponse> = waitForResult(
      () => _getStatus(controller.signal),
      interval,
      undefined,
      undefined,
      controller.signal
    ).finally(() => removePoll(txHash, promise))
    poll = { promise, controller, pinned: false }
    TRANSACTION_HASH_OBSERVERS[txHash] = poll
  }

  const resolvedStatus = await joinPoll(txHash, poll, signal)

  if (!('receiving' in resolvedStatus)) {
    throw new ServerError(
      "Status doesn't contain destination chain information."
    )
  }

  return resolvedStatus
}

function joinPoll(
  txHash: string,
  poll: StatusPoll,
  signal: AbortSignal | undefined
): Promise<StatusResponse> {
  if (!signal) {
    poll.pinned = true
    return poll.promise
  }
  const waiters = poll.waiters ?? subscribe(poll)
  return new Promise<StatusResponse>((resolve, reject) => {
    // Stop listening before settling, so a later abort cannot reach the poll.
    const waiter: Waiter = {
      resolve: (status) => {
        signal.removeEventListener('abort', leave)
        resolve(status)
      },
      reject: (error) => {
        signal.removeEventListener('abort', leave)
        reject(error)
      },
    }
    const leave = (): void => {
      // `leave` can run without the event, so the listener is not always gone.
      signal.removeEventListener('abort', leave)
      waiters.delete(waiter)
      const reason = getAbortError(signal)
      reject(reason)
      if (!poll.pinned && waiters.size === 0) {
        // A caller arriving now must start a new poll, not join this one.
        removePoll(txHash, poll.promise)
        poll.controller.abort(reason)
      }
    }
    waiters.add(waiter)
    signal.addEventListener('abort', leave, { once: true })
    if (signal.aborted) {
      leave()
    }
  })
}

/**
 * Hands the result to the callers with a signal, through one reaction per
 * poll, so a caller that leaves holds nothing here. It also handles the
 * rejection of a poll that every caller left.
 */
function subscribe(poll: StatusPoll): Set<Waiter> {
  const waiters = new Set<Waiter>()
  poll.waiters = waiters
  poll.promise.then(
    (status) => {
      for (const waiter of waiters) {
        waiter.resolve(status)
      }
    },
    (error: unknown) => {
      for (const waiter of waiters) {
        waiter.reject(error)
      }
    }
  )
  return waiters
}

/** Drops the entry for `txHash` only while it still holds this poll. */
function removePoll(txHash: string, promise: Promise<StatusResponse>): void {
  if (TRANSACTION_HASH_OBSERVERS[txHash]?.promise === promise) {
    delete TRANSACTION_HASH_OBSERVERS[txHash]
  }
}
