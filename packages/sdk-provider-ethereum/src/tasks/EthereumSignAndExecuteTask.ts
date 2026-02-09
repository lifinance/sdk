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

export class EthereumSignAndExecuteTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_SIGN_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
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
      return await new EthereumBatchSignAndExecuteTask().execute(context, {
        transactionRequest,
        calls,
      })
    }
    if (executionStrategy === 'relayer') {
      return await new EthereumRelayerSignAndExecuteTask().execute(context, {
        signedTypedData,
      })
    }
    return await new EthereumStandardSignAndExecuteTask().execute(context, {
      transactionRequest,
      signedTypedData,
    })
  }
}
