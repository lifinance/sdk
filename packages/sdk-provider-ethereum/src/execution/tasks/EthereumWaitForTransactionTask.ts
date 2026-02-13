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
    return context.isTransactionExecuted(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, checkClient } = context

    // Make sure that the chain is still correct
    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const executionStrategy: EthereumExecutionStrategy =
      await context.getExecutionStrategy(step)

    const task = this.strategies[executionStrategy]
    return await task.run(context, action)
  }
}
