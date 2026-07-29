import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { getStellarTxLink } from './helpers/getStellarTxLink.js'
import { waitForStellarTransaction } from './helpers/submitStellarTransaction.js'

export class StellarWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      fromChain,
      statusManager,
      isBridgeExecution,
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
    // persisted on the action.
    const hash = transactionHash ?? action.txHash

    if (!hash) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to wait for transaction. Transaction hash is not found.'
      )
    }

    await waitForStellarTransaction(client, hash, pollingIntervalMs)

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: hash,
      txLink: getStellarTxLink(fromChain, hash),
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
