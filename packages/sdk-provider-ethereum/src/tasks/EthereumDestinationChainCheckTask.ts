import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import type { EthereumTaskExtra } from './types.js'

/**
 * Ensures the wallet is on the correct chain when the step is waiting for a destination-chain transaction.
 */
export class EthereumDestinationChainCheckTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_DESTINATION_CHAIN_CHECK'

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { step } = context
    const destinationChainAction = step.execution?.actions.find(
      (a) => a.type === 'RECEIVING_CHAIN'
    )
    if (!destinationChainAction) {
      return { status: 'COMPLETED' }
    }
    const updatedClient = await checkClientHelper(
      step,
      destinationChainAction,
      undefined,
      context.getClient,
      context.setClient,
      context.statusManager,
      context.allowUserInteraction,
      context.switchChain
    )
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }
    return { status: 'COMPLETED' }
  }
}
