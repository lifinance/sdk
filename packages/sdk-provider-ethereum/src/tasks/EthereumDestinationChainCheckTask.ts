import type { TaskContext, TaskResult } from '@lifi/sdk'
import { EthereumStepExecutionTask } from './EthereumStepExecutionTask.js'
import type { EthereumTaskExtra } from './types.js'

/**
 * Ensures the wallet is on the correct chain when the step is waiting for a destination-chain transaction.
 */
export class EthereumDestinationChainCheckTask extends EthereumStepExecutionTask<void> {
  readonly type = 'ETHEREUM_DESTINATION_CHAIN_CHECK'

  override async shouldRun(
    _context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return true
  }

  protected async run(
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
