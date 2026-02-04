import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

/**
 * Waits for the destination-chain transaction status (bridge only).
 * Runs after we have a source-chain txHash; polls status and updates step/action.
 */
export class SuiWaitForDestinationChainTask extends BaseStepExecutionTask<
  SuiTaskExtra,
  void
> {
  readonly type = 'SUI_WAIT_FOR_DESTINATION_CHAIN'

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
