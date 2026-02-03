import type { TaskContext, TaskResult } from '@lifi/sdk'
import { waitForDestinationChainTransaction } from '@lifi/sdk'
import { SolanaStepExecutionTask } from './SolanaStepExecutionTask.js'
import type { SolanaTaskExtra } from './types.js'

/**
 * Waits for the destination-chain transaction status (bridge only).
 * Runs after we have a source-chain txHash; polls status and updates step/action.
 */
export class SolanaWaitForDestinationChainTask extends SolanaStepExecutionTask<void> {
  readonly type = 'SOLANA_WAIT_FOR_DESTINATION_CHAIN'

  override async shouldRun(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<boolean> {
    const { isBridgeExecution, action } = context
    return isBridgeExecution === true && !!(action.txHash || action.taskId)
  }

  protected override async run(
    context: TaskContext<SolanaTaskExtra>
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
