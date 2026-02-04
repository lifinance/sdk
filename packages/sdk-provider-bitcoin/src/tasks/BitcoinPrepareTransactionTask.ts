import {
  BaseStepExecutionTask,
  getStepTransaction,
  LiFiErrorCode,
  stepComparison,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { BitcoinTaskExtra } from './types.js'

export class BitcoinPrepareTransactionTask extends BaseStepExecutionTask<
  BitcoinTaskExtra,
  void
> {
  readonly type = 'BITCOIN_PREPARE_TRANSACTION'

  override async shouldRun(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      statusManager,
      actionType,
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

    context.action = statusManager.updateAction(
      step,
      actionType,
      'ACTION_REQUIRED'
    )

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return { status: 'COMPLETED' }
  }
}
