import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

/**
 * Ensures the wallet is on the correct chain when the step is waiting for a destination-chain transaction.
 */
export class EthereumDestinationChainCheckClientTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_DESTINATION_CHAIN_CHECK'
  readonly actionType = 'RECEIVING_CHAIN'

  override async shouldRun(
    _context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !!action && action.substatus !== 'WAIT_DESTINATION_TRANSACTION'
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step } = context
    const updatedClient = await context.checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }
    return { status: 'COMPLETED' }
  }
}
