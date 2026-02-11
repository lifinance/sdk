import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForTransactionReceipt } from '../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../types.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'

export class EthereumStandardWaitForTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      client,
      ethereumClient,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
    } = context

    const transactionReceipt = await waitForTransactionReceipt(client, {
      client: ethereumClient,
      chainId: fromChain.id,
      txHash: action.txHash as Hash,
      onReplaced: (response) => {
        statusManager.updateAction(step, action.type, 'PENDING', {
          txHash: response.transaction.hash,
          txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
        })
      },
    })

    action = updateActionWithReceipt(
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
