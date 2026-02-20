import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPending,
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
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, getExecutionStrategy } = context

    const executionStrategy: EthereumExecutionStrategy =
      await getExecutionStrategy(step)

    const task = this.strategies[executionStrategy]
    return await task.run(context, action)
  }
}
