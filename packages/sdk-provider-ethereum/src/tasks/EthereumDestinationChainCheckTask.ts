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

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const destinationChainAction = context.step.execution?.actions.find(
      (a) => a.type === 'RECEIVING_CHAIN'
    )
    return (
      !!destinationChainAction &&
      destinationChainAction.substatus !== 'WAIT_DESTINATION_TRANSACTION'
    )
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
