import {
  type ExecutionAction,
  type StepExecutorContext,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { EthereumDestinationChainCheckClientTask } from '../tasks/EthereumDestinationChainCheckClientTask.js'

export class EthereumReceivingChainPipeline extends TaskPipeline {
  constructor() {
    super('RECEIVING_CHAIN', [
      new EthereumDestinationChainCheckClientTask(),
      new WaitForTransactionStatusTask(),
    ])
  }

  override async shouldRun(
    context: StepExecutorContext,
    action?: ExecutionAction
  ): Promise<boolean> {
    const { isBridgeExecution } = context
    return action?.status !== 'DONE' && isBridgeExecution
  }
}
