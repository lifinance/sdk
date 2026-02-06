import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { waitForRelayedTransactionReceipt } from '../actions/waitForRelayedTransactionReceipt.js'
import { updateActionWithReceipt } from './helpers/updateActionWithReceipt.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumRelayerWaitForTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_RELAYER_WAIT_FOR_TRANSACTION'
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
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context

    const transactionReceipt = await waitForRelayedTransactionReceipt(
      client,
      action.taskId as Hash,
      step
    )

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
