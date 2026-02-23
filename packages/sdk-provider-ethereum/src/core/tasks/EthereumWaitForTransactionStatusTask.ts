import {
  BaseStepExecutionTask,
  type TaskResult,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'

export class EthereumWaitForTransactionStatusTask extends BaseStepExecutionTask {
  static override readonly name =
    'ETHEREUM_WAIT_FOR_TRANSACTION_STATUS' as const
  override readonly taskName = EthereumWaitForTransactionStatusTask.name

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, checkClient, isBridgeExecution, statusManager } = context
    // Make sure that the chain is still correct
    // If the step is waiting for a transaction on the destination chain, we do not switch the chain
    // All changes are already done from the source chain
    const destinationChainAction = statusManager.findAction(
      step,
      'RECEIVING_CHAIN'
    )

    if (
      destinationChainAction &&
      destinationChainAction?.substatus !== 'WAIT_DESTINATION_TRANSACTION'
    ) {
      const updatedClient = await checkClient(step)
      if (!updatedClient) {
        return { status: 'PAUSED' }
      }
    }

    return await new WaitForTransactionStatusTask(
      isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
    ).run(context)
  }
}
