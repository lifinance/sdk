import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { waitForTransaction as waitForTransactionHelper } from './helpers/waitForTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForTransactionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_WAIT_FOR_TRANSACTION'
  readonly displayName = 'Confirm transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action, isBridgeExecution } = context
    if (!action.txHash && !action.taskId) {
      return false
    }
    if (isBridgeExecution && action.status === 'DONE') {
      return false
    }
    return true
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      action,
      fromChain,
      toChain,
      isBridgeExecution,
      statusManager,
      ethereumClient,
    } = context

    await waitForTransactionHelper(
      client,
      {
        step,
        action,
        fromChain,
        toChain,
        isBridgeExecution,
      },
      {
        statusManager,
        ethereumClient,
      }
    )

    return { status: 'COMPLETED' }
  }
}
