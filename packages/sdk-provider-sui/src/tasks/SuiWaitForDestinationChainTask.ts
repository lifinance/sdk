import type { TaskContext, TaskResult } from '@lifi/sdk'
import { waitForDestinationChainTransaction } from '@lifi/sdk'
import { SuiStepExecutionTask } from './SuiStepExecutionTask.js'
import type { SuiTaskExtra } from './types.js'

/**
 * Waits for the destination-chain transaction status (bridge only).
 * Runs after we have a source-chain txHash; polls status and updates step/action.
 */
export class SuiWaitForDestinationChainTask extends SuiStepExecutionTask<void> {
  readonly type = 'SUI_WAIT_FOR_DESTINATION_CHAIN'

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>
  ): Promise<boolean> {
    const { isBridgeExecution, action } = context
    return isBridgeExecution === true && !!(action.txHash || action.taskId)
  }

  protected override async run(
    context: TaskContext<SuiTaskExtra>
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
