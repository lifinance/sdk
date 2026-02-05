import {
  BaseStepExecutionTask,
  type ExecutionAction,
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
  readonly actionType = 'RECEIVING_CHAIN'

  override async shouldRun(
    _context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !!action && action.status !== 'DONE'
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<void>> {
    const { step } = context
    const updatedClient = await checkClientHelper(
      step,
      action,
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
