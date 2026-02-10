import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

export class EthereumDestinationChainCheckClientTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  override async shouldRun(
    _context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    // Find if it's bridging and the step is waiting for a transaction on the destination chain
    return !!action && action.substatus !== 'WAIT_DESTINATION_TRANSACTION'
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, checkClient } = context
    // Make sure that the chain is still correct
    // If the step is waiting for a transaction on the destination chain, we do not switch the chain
    // All changes are already done from the source chain
    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    return { status: 'COMPLETED' }
  }
}
