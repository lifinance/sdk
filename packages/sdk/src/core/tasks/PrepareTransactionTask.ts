import { getStepTransaction } from '../../actions/getStepTransaction.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import {
  getFundingOrderUpdatedStep,
  isFundingOrderStep,
} from '../../utils/fundingOrderStep.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'
import { stepComparison } from './helpers/stepComparison.js'

export class PrepareTransactionTask extends BaseStepExecutionTask {
  /**
   * Whether `run()` has to fetch a fresh transaction request. The default asks
   * only when the step carries none, which keeps every existing provider
   * unchanged. Chains whose payload cannot be reused override it — see
   * `StellarPrepareTransactionTask`.
   */
  protected shouldRefetchTransaction(context: StepExecutorContext): boolean {
    return !context.step.transactionRequest
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      allowUserInteraction,
      executionOptions,
      isBridgeExecution,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    if (this.shouldRefetchTransaction(context)) {
      if (isFundingOrderStep(step)) {
        // Funding orders have no re-quote endpoint - restore the committed
        // quote from the order itself and skip the rate-change comparison.
        const updatedStep = await getFundingOrderUpdatedStep(client, step)
        Object.assign(step, updatedStep)
      } else {
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
    }

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request data is not found.'
      )
    }

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return { status: 'COMPLETED' }
  }
}
