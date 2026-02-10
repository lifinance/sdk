import { getStepTransaction } from '../actions/getStepTransaction.js'
import { BaseStepExecutionTask } from '../core/BaseStepExecutionTask.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type { ExecutionAction } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'
import { stepComparison } from './helpers/stepComparison.js'

/**
 * Base task for preparing the step transaction (get transaction request, compare, require data).
 * Shared by Sui, Bitcoin, Solana. Ethereum has its own prepare flow (contract calls, permits, etc.).
 */
export class PrepareTransactionTask<
  TContext extends TaskExtraBase,
> extends BaseStepExecutionTask<TContext> {
  override async shouldRun(
    context: TaskContext<TContext>,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<TContext>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      allowUserInteraction,
      executionOptions,
    } = context

    if (!step.transactionRequest) {
      const { execution, ...stepBase } = step
      const updatedStep = await getStepTransaction(client, stepBase)
      const comparedStep = await stepComparison(
        statusManager,
        step,
        updatedStep,
        allowUserInteraction,
        executionOptions
      )
      Object.assign(step, {
        ...comparedStep,
        execution: step.execution,
      })
    }

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return { status: 'COMPLETED' }
  }
}
