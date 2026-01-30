import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

/**
 * Ensures the wallet is on the correct chain when the step is waiting for a destination-chain transaction.
 */
export class EthereumDestinationChainCheckTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_DESTINATION_CHAIN_CHECK'
  readonly displayName = 'Check destination chain'

  async shouldRun(_context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    // Destination chain check is always run
    return true
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { step, checkClient } = context
    const destinationChainAction = step.execution?.actions.find(
      (a) => a.type === 'RECEIVING_CHAIN'
    )
    if (!destinationChainAction) {
      return { status: 'COMPLETED' }
    }
    const updatedClient = await checkClient(step, destinationChainAction)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }
    return { status: 'COMPLETED' }
  }
}
