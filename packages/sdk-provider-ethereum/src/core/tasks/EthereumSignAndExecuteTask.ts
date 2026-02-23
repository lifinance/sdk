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

export class EthereumSignAndExecuteTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_SIGN_AND_EXECUTE' as const
  override readonly taskName = EthereumSignAndExecuteTask.name

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

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      transactionRequest,
      getExecutionStrategy,
      isBridgeExecution,
    } = context

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

    const executionStrategy = await getExecutionStrategy(step)
    if (executionStrategy === 'batched' && transactionRequest) {
      return this.strategies.batched.run(context)
    }
    if (executionStrategy === 'relayed') {
      return this.strategies.relayed.run(context)
    }
    return this.strategies.standard.run(context)
  }
}
