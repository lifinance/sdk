import {
  BaseStepExecutionTask,
  getStepTransaction,
  LiFiErrorCode,
  stepComparison,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiPrepareTransactionTask extends BaseStepExecutionTask<
  SuiTaskExtra,
  void
> {
  readonly type = 'SUI_PREPARE_TRANSACTION'

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<SuiTaskExtra>
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
