import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPending,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'

export class EthereumRelayedWaitForTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context

    const transactionReceipt = await waitForRelayedTransactionReceipt(
      client,
      action.taskId as Hash,
      step
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
