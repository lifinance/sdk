import type { LiFiStep } from '@lifi/types'
import type { GetStatusRequestExtended } from '../../../types/actions.js'

/**
 * The status request for a transaction of a step. The status poll and the
 * status-API veto send the same fields, so both build them here.
 */
export function getStepStatusRequest(
  step: LiFiStep,
  txHash: string
): GetStatusRequestExtended {
  return {
    fromChain: step.action.fromChainId,
    fromAddress: step.action.fromAddress,
    toChain: step.action.toChainId,
    txHash,
    ...(step.tool !== 'custom' && { bridge: step.tool }),
    ...(step.transactionId && { transactionId: step.transactionId }),
  }
}
