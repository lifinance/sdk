import {
  type LiFiStep,
  type ProcessStatus,
  type ProcessType,
  type StatusMessage,
  type Substatus,
} from '@lifi/types'

const processMessages: Record<
  ProcessType,
  Partial<Record<ProcessStatus, string>>
> = {
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
  status: ProcessStatus
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

/**
 * Used to check if changed exchange rate is in the range of slippage threshold.
 * We use a slippage value as a threshold to trigger the rate change hook.
 * This can result in almost doubled slippage for the user and need to be revisited.
 * @param oldStep
 * @param newStep
 * @returns Boolean
 */
export function checkStepSlippageThreshold(
  oldStep: LiFiStep,
  newStep: LiFiStep
): boolean {
  const setSlippage = oldStep.action.slippage
  const oldEstimatedToAmount = BigInt(oldStep.estimate.toAmountMin)
  const newEstimatedToAmount = BigInt(newStep.estimate.toAmountMin)
  const amountDifference = oldEstimatedToAmount - newEstimatedToAmount
  // oldEstimatedToAmount can be 0 when we use contract calls
  let actualSlippage = 0
  if (oldEstimatedToAmount > 0) {
    actualSlippage =
      Number((amountDifference * 1_000_000_000n) / oldEstimatedToAmount) /
      1_000_000_000
  }
  return actualSlippage <= setSlippage
}
