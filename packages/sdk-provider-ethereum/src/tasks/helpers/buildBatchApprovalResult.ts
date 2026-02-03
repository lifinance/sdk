import type {
  ExecutionAction,
  LiFiStep,
  SignedTypedData,
  StatusManager,
} from '@lifi/sdk'
import type { Address, Hash } from 'viem'
import type { Call } from '../../types.js'

export type BatchApprovalResult = {
  status: 'BATCH_APPROVAL'
  data: { calls: Call[]; signedTypedData: SignedTypedData[] }
}

export function buildBatchApprovalResult(
  step: LiFiStep,
  sharedAction: ExecutionAction,
  statusManager: StatusManager,
  shouldResetApproval: boolean | undefined,
  approvalResetTxHash: Hash | undefined,
  approveTxHash: Hash,
  signedTypedData: SignedTypedData[]
): BatchApprovalResult {
  statusManager.updateAction(step, sharedAction.type, 'DONE')
  const calls: Call[] = []

  if (shouldResetApproval && approvalResetTxHash) {
    calls.push({
      to: step.action.fromToken.address as Address,
      data: approvalResetTxHash,
      chainId: step.action.fromToken.chainId,
    })
  }

  calls.push({
    to: step.action.fromToken.address as Address,
    data: approveTxHash,
    chainId: step.action.fromToken.chainId,
  })

  return {
    status: 'BATCH_APPROVAL',
    data: {
      calls,
      signedTypedData,
    },
  }
}
