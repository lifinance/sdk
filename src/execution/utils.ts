import {
  BridgeTool,
  ExchangeTools,
  ProcessType,
  Status,
  StatusResponse,
} from '@lifinance/types'
import { ChainId } from '..'
import ApiService from '../services/ApiService'
import { ServerError } from '../utils/errors'
import { repeatUntilDone } from '../utils/utils'

const TRANSACTION_HASH_OBSERVERS: { [txHash: string]: Promise<any> } = {}

export async function waitForReceivingTransaction(
  tool: BridgeTool | ExchangeTools,
  fromChainId: ChainId,
  toChainId: ChainId,
  txHash: string
): Promise<StatusResponse> {
  const getStatus = (): Promise<StatusResponse | undefined> =>
    new Promise(async (resolve, reject) => {
      let statusResponse: StatusResponse
      try {
        statusResponse = await ApiService.getStatus({
          bridge: tool,
          fromChain: fromChainId,
          toChain: toChainId,
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
        case 'NOT_FOUND':
          return resolve(undefined)
        case 'FAILED':
        default:
          return reject()
      }
    })

  let status
  console.log(TRANSACTION_HASH_OBSERVERS)

  if (txHash in TRANSACTION_HASH_OBSERVERS) {
    console.log('existing', TRANSACTION_HASH_OBSERVERS[txHash])
    status = await TRANSACTION_HASH_OBSERVERS[txHash]
    console.log('existing', status)
  } else {
    console.log('non existing', TRANSACTION_HASH_OBSERVERS[txHash])

    TRANSACTION_HASH_OBSERVERS[txHash] = repeatUntilDone(getStatus, 5_000)
    status = await TRANSACTION_HASH_OBSERVERS[txHash]
    console.log('non existing', status)
  }

  if (!status.receiving) {
    throw new ServerError("Status doesn't contain receiving information.")
  }

  return status
}

const processMessages: Record<ProcessType, Partial<Record<Status, string>>> = {
  TOKEN_ALLOWANCE: {
    STARTED: 'Setting token allowance.',
    PENDING: 'Waiting for token allowance approval.',
    DONE: 'Token allowance approved.',
  },
  SWITCH_CHAIN: {
    PENDING: 'Chain switch required.',
    DONE: 'Chain switched successfully.',
  },
  SWAP: {
    STARTED: 'Preparing swap.',
    ACTION_REQUIRED: 'Please sign the transaction.',
    PENDING: 'Swapping.',
    DONE: 'Swap completed.',
  },
  CROSS_CHAIN: {
    STARTED: 'Preparing transaction.',
    ACTION_REQUIRED: 'Please sign the transaction.',
    PENDING: 'Waiting for transaction.',
    DONE: 'Transaction approved.',
  },
  RECEIVING_CHAIN: {
    PENDING: 'Waiting for receiving chain.',
    DONE: 'Funds received.',
  },
  TRANSACTION: {},
}

export function getProcessMessage(
  type: ProcessType,
  status: Status
): string | undefined {
  const processMessage = processMessages[type][status]
  return processMessage
}
