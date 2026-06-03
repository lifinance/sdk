import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedWaitForTransactionTask } from './EthereumBatchedWaitForTransactionTask.js'
import { EthereumRelayedWaitForTransactionTask } from './EthereumRelayedWaitForTransactionTask.js'
import { EthereumStandardWaitForTransactionTask } from './EthereumStandardWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const executionStrategy = await getEthereumExecutionStrategy(context)
    if (executionStrategy === 'batched') {
      return new EthereumBatchedWaitForTransactionTask().run(context)
    }
    if (executionStrategy === 'relayed') {
      return new EthereumRelayedWaitForTransactionTask().run(context)
    }
    return new EthereumStandardWaitForTransactionTask().run(context)
  }
}
