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

export class EthereumRelayerGetOrCreateActionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_RELAYER_GET_OR_CREATE_ACTION'
  readonly actionType: TaskExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    _action?: ExecutionAction
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'relayer' &&
      shouldRunAllowanceCheck(context, _action) &&
      !context.allowanceFlow?.result
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    flow.sharedAction = action
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
