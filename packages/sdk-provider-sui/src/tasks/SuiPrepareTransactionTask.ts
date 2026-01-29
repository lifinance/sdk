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
    const { step, extra } = context
    if (extra.action.txHash) {
      return false
    }
    return !step.transactionRequest?.data
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { client, step, extra, allowUserInteraction } = context

    const { execution, ...stepBase } = step
    const updatedStep = await getStepTransaction(client, stepBase)
    const comparedStep = await stepComparison(
      extra.statusManager,
      step,
      updatedStep,
      allowUserInteraction,
      extra.executionOptions
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
