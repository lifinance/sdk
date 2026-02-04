import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  isAllowanceStrategy,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

/** Allowance sub-task: ensure client is ready. Sets ACTION_REQUIRED if no client. */
export class EthereumAllowanceEnsureClientTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_ENSURE_CLIENT'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      isAllowanceStrategy(context) &&
      shouldRunAllowanceCheck(context) &&
      !context.allowanceFlow?.result &&
      !!context.allowanceFlow?.sharedAction
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
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
