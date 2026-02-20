import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPrepared,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedSignAndExecuteTask } from './EthereumBatchedSignAndExecuteTask.js'
import { EthereumRelayedSignAndExecuteTask } from './EthereumRelayedSignAndExecuteTask.js'
import { EthereumStandardSignAndExecuteTask } from './EthereumStandardSignAndExecuteTask.js'

export class EthereumSignAndExecuteTask extends BaseStepExecutionTask {
  private readonly strategies: {
    batched: BaseStepExecutionTask
    relayed: BaseStepExecutionTask
    standard: BaseStepExecutionTask
  }

  constructor() {
    super()
    this.strategies = {
      batched: new EthereumBatchedSignAndExecuteTask(),
      relayed: new EthereumRelayedSignAndExecuteTask(),
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
    if (executionStrategy === 'batched' && transactionRequest) {
      return this.strategies.batched.run(context, action)
    }
    if (executionStrategy === 'relayed') {
      return this.strategies.relayed.run(context, action)
    }
    return this.strategies.standard.run(context, action)
  }
}
