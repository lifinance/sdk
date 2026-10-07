import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import type {
  EthereumStepExecutorContext,
  WalletCallReceipt,
} from '../../types.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'

/** The same check as the SDK's internal `isAbortError`. */
const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'AbortError'

export class EthereumRelayedWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      signal,
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

    let transactionReceipt: WalletCallReceipt
    try {
      // The wait starts after the relay request, so it may take the signal of
      // `stopRouteExecution`.
      transactionReceipt = await waitForRelayedTransactionReceipt(
        client,
        action.taskId as Hash,
        step,
        undefined,
        signal
      )
    } catch (error) {
      // `stopRouteExecution` ended the wait; the outcome of the relayed
      // transaction is still unknown. Pause like a stopped step, with no
      // write: the stored action keeps its task id, and a resume waits for it
      // again.
      if (signal?.aborted && isAbortError(error)) {
        return { status: 'PAUSED' }
      }
      throw error
    }

    updateActionWithReceipt(
      statusManager,
      step,
      fromChain,
      transactionReceipt,
      action
    )

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
