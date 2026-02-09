import { BaseStepExecutionTask } from '../core/BaseStepExecutionTask.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type { ExecutionAction } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'
import { checkBalance } from './helpers/checkBalance.js'

export class CheckBalanceTask<
  TContext extends TaskExtraBase,
> extends BaseStepExecutionTask<TContext> {
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
  ): Promise<TaskResult> {
    const { client, step, statusManager } = context
    statusManager.updateAction(step, action.type, 'STARTED')

    const walletAddress = step.action.fromAddress
    if (!walletAddress) {
      throw new TransactionError(
        LiFiErrorCode.InternalError,
        'The wallet address is undefined.'
      )
    }

    await checkBalance(client, walletAddress, step)
    return { status: 'COMPLETED' }
  }
}
