import type { ExecutionAction, TaskContext } from '@lifi/sdk'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import type { EthereumExecutionStrategy, EthereumTaskExtra } from '../types.js'
import type { AllowanceResult, CheckAllowanceParams } from './allowanceTypes.js'
import { checkClient as checkClientHelper } from './checkClient.js'

/** True when the execution strategy is one of the allowance strategies (standard, relayer, batch). */
export function isAllowanceStrategy(
  context: TaskContext<EthereumTaskExtra>
): context is TaskContext<EthereumTaskExtra> & {
  executionStrategy: EthereumExecutionStrategy
} {
  return (
    context.executionStrategy === 'standard' ||
    context.executionStrategy === 'relayer' ||
    context.executionStrategy === 'batch'
  )
}

/**
 * Apply a final allowance result to context (calls, signedTypedData).
 * Call this when a sub-task sets allowanceFlow.result.
 */
export function applyAllowanceResultToContext(
  context: TaskContext<EthereumTaskExtra>,
  result: AllowanceResult
): void {
  context.calls = context.calls ?? []
  context.signedTypedData = context.signedTypedData ?? []
  switch (result.status) {
    case 'BATCH_APPROVAL':
      context.calls.push(...result.data.calls)
      context.signedTypedData = result.data.signedTypedData
      break
    case 'NATIVE_PERMIT':
    case 'DONE':
      context.signedTypedData = result.data
      break
    default:
      break
  }
}

/**
 * Build CheckAllowanceParams from task context. Used by allowance sub-tasks.
 */
export function getAllowanceParams(
  context: TaskContext<EthereumTaskExtra>
): CheckAllowanceParams {
  const { step, allowUserInteraction } = context
  const disableMessageSigning =
    context.executionOptions?.disableMessageSigning || step.type !== 'lifi'
  return {
    checkClient: (s, a, tid) =>
      checkClientHelper(
        s,
        a,
        tid,
        context.getClient,
        context.setClient,
        context.statusManager,
        context.allowUserInteraction,
        context.switchChain
      ),
    chain: context.fromChain,
    step,
    statusManager: context.statusManager,
    executionOptions: context.executionOptions,
    allowUserInteraction,
    permit2Supported: getPermit2Supported(context),
    disableMessageSigning,
  }
}

/**
 * Shared shouldRun logic for all allowance tasks (standard, batch, relayer).
 * Allowance is required when: not native token, approval address present, no skip, no pending tx/taskId, action not DONE.
 */
export function shouldRunAllowanceCheck(
  context: TaskContext<EthereumTaskExtra>,
  action?: ExecutionAction
): boolean {
  const { step, fromChain } = context

  const isFromNativeToken =
    fromChain.nativeToken.address === step.action.fromToken.address &&
    isZeroAddress(step.action.fromToken.address)

  if (!action) {
    return (
      !isFromNativeToken &&
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval
    )
  }
  return (
    !action.txHash &&
    !action.taskId &&
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
