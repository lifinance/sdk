import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedSignAndExecuteTask } from './EthereumBatchedSignAndExecuteTask.js'
import { EthereumRelayedSignAndExecuteTask } from './EthereumRelayedSignAndExecuteTask.js'
import { EthereumStandardSignAndExecuteTask } from './EthereumStandardSignAndExecuteTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'

export class EthereumSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      transactionRequest,
      checkClient,
      client,
      fromChain,
      retryParams,
      executionStrategy: executionStrategyContext,
      isBridgeExecution,
    } = context

    let executionStrategy = executionStrategyContext
    if (!executionStrategyContext) {
      const updatedClient = await checkClient(step)
      if (!updatedClient) {
        return { status: 'PAUSED' }
      }
      executionStrategy = await getEthereumExecutionStrategy(
        client,
        updatedClient,
        step,
        fromChain,
        retryParams
      )
    }

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    if (executionStrategy === 'batched' && transactionRequest) {
      return new EthereumBatchedSignAndExecuteTask().run(context)
    }
    if (executionStrategy === 'relayed') {
      return new EthereumRelayedSignAndExecuteTask().run(context)
    }
    return new EthereumStandardSignAndExecuteTask().run(context)
  }
}
