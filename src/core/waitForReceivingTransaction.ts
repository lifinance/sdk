import type {
  FullStatusData,
  LiFiStep,
  ProcessType,
  StatusResponse,
} from '@lifi/types'
import { getStatus } from '../services/api.js'
import { ServerError } from '../errors/errors.js'
import { repeatUntilDone } from '../utils/utils.js'
import type { StatusManager } from './StatusManager.js'
import { getSubstatusMessage } from './processMessages.js'

const TRANSACTION_HASH_OBSERVERS: Record<string, Promise<StatusResponse>> = {}

export async function waitForReceivingTransaction(
  txHash: string,
  statusManager: StatusManager,
  processType: ProcessType,
  step: LiFiStep
): Promise<StatusResponse> {
  const _getStatus = (): Promise<StatusResponse | undefined> =>
    new Promise(async (resolve, reject) => {
      let statusResponse: StatusResponse
      try {
        statusResponse = await getStatus({
          fromChain: step.action.fromChainId,
          toChain: step.action.toChainId,
          txHash,
          ...(step.tool !== 'custom' && { bridge: step.tool }),
        })
      } catch (e: any) {
        console.debug('Fetching status from backend failed.', e)
        return resolve(undefined)
      }

      switch (statusResponse.status) {
        case 'DONE':
          return resolve(statusResponse)
        case 'PENDING':
          statusManager?.updateProcess(step, processType, 'PENDING', {
            substatus: statusResponse.substatus,
            substatusMessage:
              statusResponse.substatusMessage ||
              getSubstatusMessage(
                statusResponse.status,
                statusResponse.substatus
              ),
            txLink: (statusResponse as FullStatusData).bridgeExplorerLink,
          })
          return resolve(undefined)
        case 'NOT_FOUND':
          return resolve(undefined)
        case 'INVALID':
        case 'FAILED':
        default:
          return reject()
      }
    })

  let status

  if (txHash in TRANSACTION_HASH_OBSERVERS) {
    status = await TRANSACTION_HASH_OBSERVERS[txHash]
  } else {
    TRANSACTION_HASH_OBSERVERS[txHash] = repeatUntilDone(_getStatus, 5_000)
    status = await TRANSACTION_HASH_OBSERVERS[txHash]
  }

  if (!('receiving' in status)) {
    throw new ServerError("Status doesn't contain receiving information.")
  }

  return status
}
