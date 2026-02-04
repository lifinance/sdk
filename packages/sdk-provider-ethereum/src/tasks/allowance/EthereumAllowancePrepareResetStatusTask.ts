import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import {
  isAllowanceStrategy,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

/** Allowance sub-task: prepare reset/approval status (RESET_REQUIRED or ACTION_REQUIRED). */
export class EthereumAllowancePrepareResetStatusTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_PREPARE_RESET_STATUS'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const flow = context.allowanceFlow
    return (
      isAllowanceStrategy(context) &&
      shouldRunAllowanceCheck(context) &&
      !flow?.result &&
      flow?.spenderAddress !== undefined &&
      flow?.approved !== undefined &&
      flow?.fromAmount !== undefined
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
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
