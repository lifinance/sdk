import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type {
  EthereumExecutionStrategy,
  EthereumStepExecutorContext,
} from '../../types.js'
import { EthereumBatchWaitForTransactionTask } from './EthereumBatchWaitForTransactionTask.js'
import { EthereumRelayerWaitForTransactionTask } from './EthereumRelayerWaitForTransactionTask.js'
import { EthereumStandardWaitForTransactionTask } from './EthereumStandardWaitForTransactionTask.js'

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask {
  private readonly strategies: {
    batch: BaseStepExecutionTask
    relayer: BaseStepExecutionTask
    standard: BaseStepExecutionTask
  }

  constructor() {
    super()
    this.strategies = {
      batch: new EthereumBatchWaitForTransactionTask(),
      relayer: new EthereumRelayerWaitForTransactionTask(),
      standard: new EthereumStandardWaitForTransactionTask(),
    }
  }

  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, checkClient, getExecutionStrategy } = context

    // Make sure that the chain is still correct
    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
    }

    const executionStrategy: EthereumExecutionStrategy =
      await getExecutionStrategy(step)

    const task = this.strategies[executionStrategy]
    return await task.run(context, action)
  }
}
