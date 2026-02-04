import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import { waitForTransaction as waitForTransactionHelper } from './helpers/waitForTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
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
    } = context

    const updatedClient = await checkClientHelper(step, action, undefined, {
      getClient: context.getClient,
      setClient: context.setClient,
      statusManager: context.statusManager,
      allowUserInteraction: context.allowUserInteraction,
      switchChain: context.switchChain,
    })
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
