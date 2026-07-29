import {
  BaseStepExecutionTask,
  getStepTransaction,
  LiFiErrorCode,
  stepComparison,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'

/**
 * Re-fetches the step transaction from the backend, **unconditionally**.
 *
 * Do not reintroduce the base task's `if (!step.transactionRequest)` guard. A
 * Stellar envelope is not a reusable payload: the backend embeds the sender's
 * account sequence number and timebounds `[0, now + 300s]` at build time. Two
 * things follow.
 *
 * 1. Staleness. On the quote path `convertQuoteToRoute` carries the quote's
 *    `transactionRequest` into the route, so the guarded base task would never
 *    re-fetch and would sign an envelope minted minutes earlier — expiring as
 *    `tx_too_late` once the user lingers in their wallet. The retry path has the
 *    same problem: it resets `step.execution` but not `step.transactionRequest`.
 * 2. Approvals. `StellarSetAllowanceTask` submits a transaction of its own, which
 *    consumes the sender's sequence number. Any envelope built before that
 *    approval is invalid (`tx_bad_seq`), so the envelope has to be requested
 *    after it — which only happens if this task always asks for a fresh one.
 */
export class StellarPrepareTransactionTask extends BaseStepExecutionTask {
  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
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

    const { execution: _execution, ...stepBase } = step
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
