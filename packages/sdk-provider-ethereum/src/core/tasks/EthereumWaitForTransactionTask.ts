import {
  BaseStepExecutionTask,
  type TaskResult,
  type TransactionMethodType,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedWaitForTransactionTask } from './EthereumBatchedWaitForTransactionTask.js'
import { EthereumRelayedWaitForTransactionTask } from './EthereumRelayedWaitForTransactionTask.js'
import { EthereumStandardWaitForTransactionTask } from './EthereumStandardWaitForTransactionTask.js'

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_WAIT_FOR_TRANSACTION' as const
  override readonly taskName = EthereumWaitForTransactionTask.name

  private readonly strategies: {
    batched: BaseStepExecutionTask
    relayed: BaseStepExecutionTask
    standard: BaseStepExecutionTask
  }

  constructor() {
    super()
    this.strategies = {
      batched: new EthereumBatchedWaitForTransactionTask(),
      relayed: new EthereumRelayedWaitForTransactionTask(),
      standard: new EthereumStandardWaitForTransactionTask(),
    }
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, getExecutionStrategy } = context

    const executionStrategy: TransactionMethodType =
      await getExecutionStrategy(step)

    const task = this.strategies[executionStrategy]

    return await task.run(context)
  }
}
