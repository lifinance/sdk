import { getStepTransaction } from '../actions/getStepTransaction.js'
import { BaseStepExecutionTask } from '../core/BaseStepExecutionTask.js'
import { stepComparison } from '../core/stepComparison.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'

/**
 * Base task for preparing the step transaction (get transaction request, compare, require data).
 * Shared by Sui, Bitcoin, Solana. Ethereum has its own prepare flow (contract calls, permits, etc.).
 */
export class PrepareTransactionTask<
  TContext extends TaskExtraBase,
> extends BaseStepExecutionTask<TContext, void> {
  override readonly type = 'PREPARE_TRANSACTION'

  override async shouldRun(context: TaskContext<TContext>): Promise<boolean> {
    return !context.isTransactionExecuted()
  }

  protected override async run(
    context: TaskContext<TContext>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      statusManager,
      allowUserInteraction,
      executionOptions,
      isBridgeExecution,
    } = context
    const action = context.getOrCreateAction(
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

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
