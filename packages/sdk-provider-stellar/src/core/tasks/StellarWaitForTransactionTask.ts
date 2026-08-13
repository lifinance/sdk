import {
  BaseError,
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { probeStellarTransaction } from './helpers/probeStellarTransaction.js'
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
    // never have reached the network — but it may equally have been applied
    // already, in which case its sequence number is spent and re-submitting can
    // only fail. Ask the network first, and let the poll below decide the
    // outcome either way.
    let resubmitError: unknown
    if (!transactionHash && action.txHex) {
      const probe = await probeStellarTransaction(client, hash)
      if (probe !== 'landed') {
        try {
          await submitStellarTransaction(
            client,
            action.txHex,
            networkPassphrase
          )
        } catch (error) {
          // Keep it only when the probe was definite. After a failed probe this
          // may be a txBAD_SEQ from a swap that in fact settled.
          resubmitError = probe === 'not-found' ? error : undefined
        }
      }
    }

    try {
      await waitForStellarTransaction(client, hash, pollingIntervalMs)
    } catch (error) {
      // The envelope never reached the network, and the poll can only report
      // that as a timeout. The submission error says why.
      if (
        resubmitError &&
        error instanceof BaseError &&
        error.code === LiFiErrorCode.Timeout
      ) {
        throw resubmitError
      }
      throw error
    }

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
