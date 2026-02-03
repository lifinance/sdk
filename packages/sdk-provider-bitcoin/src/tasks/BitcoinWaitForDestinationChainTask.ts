import type { TaskContext, TaskResult } from '@lifi/sdk'
import { waitForDestinationChainTransaction } from '@lifi/sdk'
import { BitcoinStepExecutionTask } from './BitcoinStepExecutionTask.js'
import type { BitcoinTaskExtra } from './types.js'

const POLLING_INTERVAL_MS = 10_000

/**
 * Waits for the destination-chain transaction status (bridge only).
 * Runs after we have a source-chain txHash; polls status and updates step/action.
 */
export class BitcoinWaitForDestinationChainTask extends BitcoinStepExecutionTask<void> {
  readonly type = 'BITCOIN_WAIT_FOR_DESTINATION_CHAIN'

  protected override async run(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, action, fromChain, toChain, statusManager } = context
    await waitForDestinationChainTransaction(
      client,
      step,
      action,
      fromChain,
      toChain,
      statusManager,
      POLLING_INTERVAL_MS
    )
    return { status: 'COMPLETED' }
  }
}
