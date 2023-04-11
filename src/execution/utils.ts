import {
  LifiStep,
  ProcessType,
  Status,
  StatusMessage,
  StatusResponse,
  Substatus,
} from '@lifi/types'
import BigNumber from 'bignumber.js'
import { StatusManager } from '..'

import ApiService from '../services/ApiService'
import { ServerError } from '../utils/errors'
import { repeatUntilDone } from '../utils/utils'

const TRANSACTION_HASH_OBSERVERS: { [txHash: string]: Promise<any> } = {}

export async function waitForReceivingTransaction(
  txHash: string,
  statusManager: StatusManager,
  processType: ProcessType,
  step: LifiStep
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
            ...(statusResponse.bridgeExplorerLink && {
              txLink: statusResponse.bridgeExplorerLink,
            }),
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

const processMessages: Record<ProcessType, Partial<Record<Status, string>>> = {
  TOKEN_ALLOWANCE: {
    STARTED: 'Setting token allowance.',
    PENDING: 'Waiting for token allowance.',
    DONE: 'Token allowance set.',
  },
  SWITCH_CHAIN: {
    PENDING: 'Chain switch required.',
    DONE: 'Chain switched successfully.',
  },
  SWAP: {
    STARTED: 'Preparing swap transaction.',
    ACTION_REQUIRED: 'Please sign the transaction.',
    PENDING: 'Waiting for swap transaction.',
    DONE: 'Swap completed.',
  },
  CROSS_CHAIN: {
    STARTED: 'Preparing bridge transaction.',
    ACTION_REQUIRED: 'Please sign the transaction.',
    PENDING: 'Waiting for bridge transaction.',
    DONE: 'Bridge transaction confirmed.',
  },
  RECEIVING_CHAIN: {
    PENDING: 'Waiting for destination chain.',
    DONE: 'Bridge completed.',
  },
  TRANSACTION: {},
}
const substatusMessages: Record<
  StatusMessage,
  Partial<Record<Substatus, string>>
> = {
  PENDING: {
    BRIDGE_NOT_AVAILABLE: 'Bridge communication is temporarily unavailable.',
    CHAIN_NOT_AVAILABLE: 'RPC communication is temporarily unavailable.',
    NOT_PROCESSABLE_REFUND_NEEDED:
      'The transfer cannot be completed successfully. A refund operation is required.',
    UNKNOWN_ERROR:
      'An unexpected error occurred. Please seek assistance in the LI.FI discord server.',
    WAIT_SOURCE_CONFIRMATIONS:
      'The bridge deposit has been received. The bridge is waiting for more confirmations to start the off-chain logic.',
    WAIT_DESTINATION_TRANSACTION:
      'The bridge off-chain logic is being executed. Wait for the transaction to appear on the destination chain.',
  },
  DONE: {
    PARTIAL:
      'Some of the received tokens are not the requested destination tokens.',
    REFUNDED: 'The tokens were refunded to the sender address.',
    COMPLETED: 'The transfer is complete.',
  },
  FAILED: {},
  INVALID: {},
  NOT_FOUND: {},
}

export function getProcessMessage(
  type: ProcessType,
  status: Status
): string | undefined {
  const processMessage = processMessages[type][status]
  return processMessage
}

export function getSubstatusMessage(
  status: StatusMessage,
  substatus?: Substatus
): string | undefined {
  if (!substatus) {
    return
  }
  const message = substatusMessages[status][substatus]
  return message
}

// Used to check if changed exchange rate is in the range of slippage threshold
export function checkStepSlippageThreshold(
  oldStep: LifiStep,
  newStep: LifiStep
): boolean {
  const setSlippage = new BigNumber(oldStep.action.slippage)
  const oldEstimatedToAmount = new BigNumber(oldStep.estimate.toAmountMin)
  const newEstimatedToAmount = new BigNumber(newStep.estimate.toAmountMin)
  const amountDifference = oldEstimatedToAmount.minus(newEstimatedToAmount)
  const actualSlippage = amountDifference.dividedBy(oldEstimatedToAmount)
  return (
    newEstimatedToAmount.gte(oldEstimatedToAmount) &&
    actualSlippage.lte(setSlippage)
  )
}
