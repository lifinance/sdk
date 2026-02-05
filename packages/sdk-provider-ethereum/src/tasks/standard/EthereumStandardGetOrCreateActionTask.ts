import {
  BaseStepExecutionTask,
  type ExecutionActionType,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { shouldRunAllowanceCheck } from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumStandardGetOrCreateActionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_STANDARD_GET_OR_CREATE_ACTION'
  readonly actionType: ExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'standard' &&
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
