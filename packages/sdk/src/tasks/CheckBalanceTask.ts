import { BaseStepExecutionTask } from '../core/BaseStepExecutionTask.js'
import { checkBalance } from '../core/checkBalance.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'

export class CheckBalanceTask<
  TContext extends TaskExtraBase,
> extends BaseStepExecutionTask<TContext, void> {
  override readonly type: string = 'CHECK_BALANCE'

  override async shouldRun(context: TaskContext<TContext>): Promise<boolean> {
    return !context.isTransactionExecuted()
  }

  protected override async run(
    context: TaskContext<TContext>
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, isBridgeExecution } = context
    const action = context.getOrCreateAction(
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    statusManager.updateAction(step, action.type, 'STARTED')
    await checkBalance(client, context.getWalletAddress(), step)
    return { status: 'COMPLETED' }
  }
}
