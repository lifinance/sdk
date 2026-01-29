import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import {
  getStepTransaction,
  LiFiErrorCode,
  stepComparison,
  TransactionError,
} from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiPrepareTransactionTask
  implements ExecutionTask<SuiTaskExtra, void>
{
  readonly type = 'SUI_PREPARE_TRANSACTION'
  readonly displayName = 'Prepare transaction'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { step, action } = context
    return (
      !action.txHash &&
      !step.transactionRequest?.data &&
      action.status !== 'DONE'
    )
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const {
      client,
      step,
      statusManager,
      allowUserInteraction,
      executionOptions,
    } = context

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

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    return { status: 'COMPLETED' }
  }
}
