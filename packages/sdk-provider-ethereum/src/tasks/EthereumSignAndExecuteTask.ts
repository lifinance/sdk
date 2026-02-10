import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
  type TransactionParameters,
} from '@lifi/sdk'
import type { Call } from '../types.js'
import { EthereumBatchSignAndExecuteTask } from './EthereumBatchSignAndExecuteTask.js'
import { EthereumRelayerSignAndExecuteTask } from './EthereumRelayerSignAndExecuteTask.js'
import { EthereumStandardSignAndExecuteTask } from './EthereumStandardSignAndExecuteTask.js'
import type { EthereumTaskExtra } from './types.js'

export interface EthereumSignAndExecuteStrategyTasks {
  batch: BaseStepExecutionTask<EthereumTaskExtra>
  relayer: BaseStepExecutionTask<EthereumTaskExtra>
  standard: BaseStepExecutionTask<EthereumTaskExtra>
}
export class EthereumSignAndExecuteTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  private readonly strategies: EthereumSignAndExecuteStrategyTasks

  constructor() {
    super()
    this.strategies = {
      batch: new EthereumBatchSignAndExecuteTask(),
      relayer: new EthereumRelayerSignAndExecuteTask(),
      standard: new EthereumStandardSignAndExecuteTask(),
    }
  }

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
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
