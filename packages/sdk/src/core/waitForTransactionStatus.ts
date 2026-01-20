import type { FullStatusData, StatusResponse } from '@lifi/types'
import { getStatus } from '../actions/getStatus.js'
import { ServerError } from '../errors/errors.js'
import type { LiFiStepExtended, SDKClient } from '../types/core.js'
import { waitForResult } from '../utils/waitForResult.js'
import { getSubstatusMessage } from './processMessages.js'
import type { StatusManager } from './statusManager/StatusManager.js'

const TRANSACTION_HASH_OBSERVERS: Record<string, Promise<StatusResponse>> = {}

export async function waitForTransactionStatus(
  client: SDKClient,
  statusManager: StatusManager,
  txHash: string,
  step: LiFiStepExtended,
  interval = 5_000
): Promise<StatusResponse> {
  const _getStatus = (): Promise<StatusResponse | undefined> => {
    return getStatus(client, {
      fromChain: step.action.fromChainId,
      fromAddress: step.action.fromAddress,
      toChain: step.action.toChainId,
      txHash,
      ...(step.tool !== 'custom' && { bridge: step.tool }),
    })
      .then((statusResponse) => {
        switch (statusResponse.status) {
          case 'DONE':
            return statusResponse
          case 'PENDING':
            step = statusManager?.updateExecution(step, {
              type: step.execution!.type,
              status: 'PENDING',
              pendingAt: Date.now(),
              substatus: statusResponse.substatus,
              substatusMessage:
                statusResponse.substatusMessage ||
                getSubstatusMessage(
                  statusResponse.status,
                  statusResponse.substatus
                ),
              transaction: {
                type: step.execution!.type,
                txLink: (statusResponse as FullStatusData).bridgeExplorerLink,
              },
            })
            return undefined
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

  let status = TRANSACTION_HASH_OBSERVERS[txHash]

  if (!status) {
    status = waitForResult(_getStatus, interval)
    TRANSACTION_HASH_OBSERVERS[txHash] = status
  }

  const resolvedStatus = await status

  if (!('receiving' in resolvedStatus)) {
    throw new ServerError(
      "Status doesn't contain destination chain information."
    )
  }

  return resolvedStatus
}
