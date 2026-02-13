import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'

export class EthereumDestinationChainCheckClientTask extends BaseStepExecutionTask {
  override async shouldRun(
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    // Find if it's bridging and the step is waiting for a transaction on the destination chain
    return action.substatus !== 'WAIT_DESTINATION_TRANSACTION'
  }

  async run(
    context: EthereumStepExecutorContext,
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
