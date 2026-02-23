import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import type {
  EthereumStepExecutorContext,
  WalletCallReceipt,
} from '../../types.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'

export class EthereumBatchedWaitForTransactionTask extends BaseStepExecutionTask {
  static override readonly name =
    'ETHEREUM_BATCHED_WAIT_FOR_TRANSACTION' as const
  override readonly taskName = EthereumBatchedWaitForTransactionTask.name

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, statusManager, fromChain, isBridgeExecution, checkClient } =
      context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const transactionReceipt = await waitForBatchTransactionReceipt(
      updatedClient,
      action.taskId as Hash,
      (result) => {
        const receipt = result.receipts?.find((r) => r.status === 'reverted') as
          | WalletCallReceipt
          | undefined
        if (receipt) {
          updateActionWithReceipt(
            statusManager,
            step,
            fromChain,
            receipt,
            action
          )
        }
      }
    )

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
