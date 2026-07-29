import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { submitStellarTransaction } from './helpers/submitStellarTransaction.js'
import { waitForStellarTransaction } from './helpers/waitForStellarTransaction.js'

export class StellarWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      statusManager,
      isBridgeExecution,
      networkPassphrase,
      pollingIntervalMs,
      transactionHash,
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

    // On a resumed route the signing task didn't run, so fall back to the hash
    // and envelope it persisted on the action. This is the entry point
    // StellarStepExecutor.createPipeline resumes to when a step was signed but
    // never confirmed.
    const hash = transactionHash ?? action.txHash

    if (!hash) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to wait for transaction. Transaction hash is not found.'
      )
    }

    // Resuming: the hash is persisted before submission, so the envelope may
    // never have reached the network. Re-submit it before polling — Soroban
    // submission is idempotent by hash and reports an already-known envelope as
    // DUPLICATE, which submitStellarTransaction treats as success. Without this,
    // a crash between persisting and submitting would strand the step polling
    // for a transaction that was never broadcast.
    if (!transactionHash && action.txHex) {
      await submitStellarTransaction(client, action.txHex, networkPassphrase)
    }

    await waitForStellarTransaction(client, hash, pollingIntervalMs)

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
