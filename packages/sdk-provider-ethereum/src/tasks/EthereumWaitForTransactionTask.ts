import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { EthereumBatchWaitForTransactionTask } from './EthereumBatchWaitForTransactionTask.js'
import { EthereumRelayerWaitForTransactionTask } from './EthereumRelayerWaitForTransactionTask.js'
import { EthereumStandardWaitForTransactionTask } from './EthereumStandardWaitForTransactionTask.js'
import type { EthereumTaskExtra } from './types.js'

/**
 * Ensures the wallet is on the correct chain when the step is waiting for a destination-chain transaction.
 */
export class EthereumWaitForTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_WAIT_FOR_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
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

    const executionStrategy = await context.getExecutionStrategy(step)
    if (executionStrategy === 'batch') {
      return await new EthereumBatchWaitForTransactionTask().execute(context)
    }
    if (executionStrategy === 'relayer') {
      return await new EthereumRelayerWaitForTransactionTask().execute(context)
    }
    return await new EthereumStandardWaitForTransactionTask().execute(context)
  }
}
