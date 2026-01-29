import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { waitForTransaction as waitForTransactionHelper } from './helpers/waitForTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForTransactionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_WAIT_FOR_TRANSACTION'
  readonly displayName = 'Confirm transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action, isBridgeExecution } = context.extra
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
    const { client, step, extra } = context

    await waitForTransactionHelper(
      client,
      {
        step,
        action: extra.action,
        fromChain: extra.fromChain,
        toChain: extra.toChain,
        isBridgeExecution: extra.isBridgeExecution,
      },
      {
        statusManager: extra.statusManager,
        ethereumClient: extra.ethereumClient,
      }
    )

    return { status: 'COMPLETED' }
  }
}
