import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPrepared,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
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
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPrepared(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      transactionRequest,
      getExecutionStrategy,
    } = context

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const executionStrategy = await getExecutionStrategy(step)
    if (executionStrategy === 'batch' && transactionRequest) {
      return this.strategies.batch.run(context, action)
    }
    if (executionStrategy === 'relayer') {
      return this.strategies.relayer.run(context, action)
    }
    return this.strategies.standard.run(context, action)
  }
}
