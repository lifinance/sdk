import { BaseStepExecutionTask } from '../core/BaseStepExecutionTask.js'
import { checkBalance } from '../core/checkBalance.js'
import type { ExecutionAction } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'

export class CheckBalanceTask<
  TContext extends TaskExtraBase,
> extends BaseStepExecutionTask<TContext, void> {
  readonly type: string = 'CHECK_BALANCE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<TContext>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<TContext>,
    action: ExecutionAction
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager } = context
    statusManager.updateAction(step, action.type, 'STARTED')
    await checkBalance(client, context.getWalletAddress(), step)
    return { status: 'COMPLETED' }
  }
}
