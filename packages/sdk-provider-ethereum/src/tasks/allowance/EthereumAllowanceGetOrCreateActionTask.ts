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

/** Allowance sub-task: get or create TOKEN_ALLOWANCE action; store in allowanceFlow.sharedAction. */
export class EthereumAllowanceGetOrCreateActionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_GET_OR_CREATE_ACTION'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      isAllowanceStrategy(context) &&
      shouldRunAllowanceCheck(context) &&
      !context.allowanceFlow?.result
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    const sharedAction = context.statusManager.findOrCreateAction({
      step: context.step,
      type: 'TOKEN_ALLOWANCE',
      chainId: context.step.action.fromChainId,
    })
    flow.sharedAction = sharedAction
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
