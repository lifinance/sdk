import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { ExecutionAction } from '../../types/core.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'
import { checkBalance } from './helpers/checkBalance.js'

export class CheckBalanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: StepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: StepExecutorContext,
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
