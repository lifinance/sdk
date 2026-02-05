import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskExecutionActionType,
  type TaskResult,
} from '@lifi/sdk'
import { shouldRunAllowanceCheck } from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumStandardPrepareResetStatusTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_STANDARD_PREPARE_RESET_STATUS'
  readonly actionType: TaskExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    _action?: ExecutionAction
  ): Promise<boolean> {
    const flow = context.allowanceFlow
    return (
      context.executionStrategy === 'standard' &&
      shouldRunAllowanceCheck(context, _action) &&
      !flow?.result &&
      flow?.spenderAddress !== undefined &&
      flow?.approved !== undefined &&
      flow?.fromAmount !== undefined
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    _action: ExecutionAction
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    const shouldResetApproval = !!(
      context.step.estimate.approvalReset && flow.approved! > 0n
    )
    flow.shouldResetApproval = shouldResetApproval
    const resetApprovalStatus = shouldResetApproval
      ? 'RESET_REQUIRED'
      : 'ACTION_REQUIRED'
    context.statusManager.updateAction(
      context.step,
      flow.sharedAction!.type,
      resetApprovalStatus,
      { txHash: undefined, txLink: undefined }
    )
    if (!context.allowUserInteraction) {
      flow.result = { status: 'ACTION_REQUIRED' }
      return { status: 'PAUSED', data: { allowanceFlow: flow } }
    }
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
