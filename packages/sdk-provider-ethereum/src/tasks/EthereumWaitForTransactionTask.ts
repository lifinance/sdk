import type { TaskContext, TaskResult } from '@lifi/sdk'
import { EthereumStepExecutionTask } from './EthereumStepExecutionTask.js'
import { waitForTransaction as waitForTransactionHelper } from './helpers/waitForTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForTransactionTask extends EthereumStepExecutionTask<void> {
  readonly type = 'ETHEREUM_WAIT_FOR_TRANSACTION'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !!(action.txHash || action.taskId) && action.status !== 'DONE'
  }

  protected async run(
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
