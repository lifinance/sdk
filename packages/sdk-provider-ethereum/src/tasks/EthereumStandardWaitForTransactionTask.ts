import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForTransactionReceipt } from '../actions/waitForTransactionReceipt.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumStandardWaitForTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_STANDARD_WAIT_FOR_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
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
