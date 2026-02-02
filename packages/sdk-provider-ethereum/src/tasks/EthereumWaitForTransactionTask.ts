import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { waitForTransaction as waitForTransactionHelper } from './helpers/waitForTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForTransactionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_WAIT_FOR_TRANSACTION'
  readonly displayName = 'Confirm transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context
    return !!(action.txHash || action.taskId) && action.status !== 'DONE'
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
      checkClient,
    } = context

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

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
        ethereumClient: updatedClient ?? ethereumClient,
      }
    )

    return { status: 'COMPLETED' }
  }
}
