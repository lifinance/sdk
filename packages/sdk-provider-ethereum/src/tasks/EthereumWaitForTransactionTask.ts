import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import { EthereumBatchWaitForTransactionTask } from './EthereumBatchWaitForTransactionTask.js'
import { EthereumRelayerWaitForTransactionTask } from './EthereumRelayerWaitForTransactionTask.js'
import { EthereumStandardWaitForTransactionTask } from './EthereumStandardWaitForTransactionTask.js'
import type { EthereumExecutionStrategy, EthereumTaskExtra } from './types.js'

export interface EthereumWaitForTransactionStrategyTasks {
  batch: BaseStepExecutionTask<EthereumTaskExtra>
  relayer: BaseStepExecutionTask<EthereumTaskExtra>
  standard: BaseStepExecutionTask<EthereumTaskExtra>
}

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  private readonly strategies: EthereumWaitForTransactionStrategyTasks

  constructor() {
    super()
    this.strategies = {
      batch: new EthereumBatchWaitForTransactionTask(),
      relayer: new EthereumRelayerWaitForTransactionTask(),
      standard: new EthereumStandardWaitForTransactionTask(),
    }
  }

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
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
    const result = await task.run(context, action)
    return result
  }
}
