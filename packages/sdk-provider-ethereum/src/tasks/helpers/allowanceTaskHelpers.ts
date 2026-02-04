import type { TaskContext } from '@lifi/sdk'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import type { EthereumTaskExtra } from '../types.js'

/**
 * Shared shouldRun logic for all allowance tasks (standard, batch, relayer).
 * Allowance is required when: not native token, approval address present, no skip, no pending tx/taskId, action not DONE.
 */
export function shouldRunAllowanceCheck(
  context: TaskContext<EthereumTaskExtra>
): boolean {
  const { step, action, fromChain } = context

  const isFromNativeToken =
    fromChain.nativeToken.address === step.action.fromToken.address &&
    isZeroAddress(step.action.fromToken.address)

  return (
    !action?.txHash &&
    !action?.taskId &&
    !isFromNativeToken &&
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval &&
    action.status !== 'DONE'
  )
}

/**
 * Whether permit2 (and permit2Proxy) is supported for this step. Used by allowance and sign-and-execute tasks.
 */
export function getPermit2Supported(
  context: TaskContext<EthereumTaskExtra>
): boolean {
  const { step, fromChain, executionOptions, executionStrategy } = context
  const batchingSupported = executionStrategy === 'batch'
  const isFromNativeToken =
    fromChain.nativeToken.address === step.action.fromToken.address &&
    isZeroAddress(step.action.fromToken.address)
  const disableMessageSigning =
    executionOptions?.disableMessageSigning || step.type !== 'lifi'
  return (
    !!fromChain.permit2 &&
    !!fromChain.permit2Proxy &&
    !batchingSupported &&
    !isFromNativeToken &&
    !disableMessageSigning &&
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval &&
    !step.estimate.skipPermit
  )
}
