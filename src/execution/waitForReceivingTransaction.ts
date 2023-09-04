import type {
  FullStatusData,
  LiFiStep,
  ProcessType,
  StatusResponse,
} from '@lifi/types'
import ApiService from '../services/ApiService'
import { ServerError } from '../utils/errors'
import { repeatUntilDone } from '../utils/utils'
import type { StatusManager } from './StatusManager'
import { getSubstatusMessage } from './utils'

const TRANSACTION_HASH_OBSERVERS: Record<string, Promise<StatusResponse>> = {}

export async function waitForReceivingTransaction(
  txHash: string,
  statusManager: StatusManager,
  processType: ProcessType,
  step: LiFiStep
): Promise<StatusResponse> {
  const getStatus = (): Promise<StatusResponse | undefined> =>
    new Promise(async (resolve, reject) => {
      let statusResponse: StatusResponse
      try {
        statusResponse = await ApiService.getStatus({
          bridge: step.tool,
          fromChain: step.action.fromChainId,
          toChain: step.action.toChainId,
          txHash,
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
        case 'FAILED':
        default:
          return reject()
      }
    })

  let status

  if (txHash in TRANSACTION_HASH_OBSERVERS) {
    status = await TRANSACTION_HASH_OBSERVERS[txHash]
  } else {
    TRANSACTION_HASH_OBSERVERS[txHash] = repeatUntilDone(getStatus, 5_000)
    status = await TRANSACTION_HASH_OBSERVERS[txHash]
  }

  if (!status.receiving) {
    throw new ServerError("Status doesn't contain receiving information.")
  }

  return status
}
