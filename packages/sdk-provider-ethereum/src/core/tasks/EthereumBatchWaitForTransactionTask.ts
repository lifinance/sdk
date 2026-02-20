import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import type {
  EthereumStepExecutorContext,
  WalletCallReceipt,
} from '../../types.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'

export class EthereumBatchWaitForTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, statusManager, fromChain, isBridgeExecution, checkClient } =
      context

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
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
