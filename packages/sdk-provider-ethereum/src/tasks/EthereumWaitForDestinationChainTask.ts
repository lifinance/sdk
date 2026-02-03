import type { TaskContext, TaskResult } from '@lifi/sdk'
import { waitForDestinationChainTransaction } from '@lifi/sdk'
import { EthereumStepExecutionTask } from './EthereumStepExecutionTask.js'
import type { EthereumTaskExtra } from './types.js'

/**
 * Waits for the destination-chain transaction status (bridge only).
 * Runs after we have a source-chain txHash; polls status and updates step/action.
 */
export class EthereumWaitForDestinationChainTask extends EthereumStepExecutionTask<void> {
  readonly type = 'ETHEREUM_WAIT_FOR_DESTINATION_CHAIN'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { isBridgeExecution, action } = context
    return isBridgeExecution === true && !!(action.txHash || action.taskId)
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, action, fromChain, toChain, statusManager } = context
    await waitForDestinationChainTransaction(
      client,
      step,
      action,
      fromChain,
      toChain,
      statusManager
    )
    return { status: 'COMPLETED' }
  }
}
