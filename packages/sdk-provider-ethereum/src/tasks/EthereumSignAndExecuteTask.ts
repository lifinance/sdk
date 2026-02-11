import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskResult,
  type TransactionParameters,
} from '@lifi/sdk'
import type { Call, EthereumStepExecutorContext } from '../types.js'
import { EthereumBatchSignAndExecuteTask } from './EthereumBatchSignAndExecuteTask.js'
import { EthereumRelayerSignAndExecuteTask } from './EthereumRelayerSignAndExecuteTask.js'
import { EthereumStandardSignAndExecuteTask } from './EthereumStandardSignAndExecuteTask.js'

export class EthereumSignAndExecuteTask extends BaseStepExecutionTask {
  private readonly strategies: {
    batch: BaseStepExecutionTask
    relayer: BaseStepExecutionTask
    standard: BaseStepExecutionTask
  }

  constructor() {
    super()
    this.strategies = {
      batch: new EthereumBatchSignAndExecuteTask(),
      relayer: new EthereumRelayerSignAndExecuteTask(),
      standard: new EthereumStandardSignAndExecuteTask(),
    }
  }

  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      calls: Call[]
      transactionRequest: TransactionParameters
    }
  ): Promise<TaskResult> {
    const { step, statusManager, allowUserInteraction } = context

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const { signedTypedData, calls, transactionRequest } = payload
    const executionStrategy = await context.getExecutionStrategy(step)
    if (executionStrategy === 'batch' && transactionRequest) {
      return this.strategies.batch.run(context, action, {
        transactionRequest,
        calls,
      })
    }
    if (executionStrategy === 'relayer') {
      return this.strategies.relayer.run(context, action, { signedTypedData })
    }
    return this.strategies.standard.run(context, action, {
      transactionRequest,
      signedTypedData,
    })
  }
}
