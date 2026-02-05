import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskExecutionActionType,
  type TaskResult,
} from '@lifi/sdk'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumStandardEnsureClientTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_STANDARD_ENSURE_CLIENT'
  readonly actionType: TaskExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    _action?: ExecutionAction
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'standard' &&
      shouldRunAllowanceCheck(context, _action) &&
      !context.allowanceFlow?.result &&
      !!context.allowanceFlow?.sharedAction
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    _action: ExecutionAction
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    const updatedClient =
      (await getAllowanceParams(context).checkClient(
        context.step,
        flow.sharedAction!
      )) ?? null
    if (!updatedClient) {
      flow.result = { status: 'ACTION_REQUIRED' }
      applyAllowanceResultToContext(context, flow.result)
      if (!context.allowUserInteraction) {
        return { status: 'PAUSED', data: { allowanceFlow: flow } }
      }
      return { status: 'COMPLETED', data: { allowanceFlow: flow } }
    }
    flow.updatedClient = updatedClient
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
