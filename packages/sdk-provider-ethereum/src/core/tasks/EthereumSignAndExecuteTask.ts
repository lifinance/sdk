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

    const executionStrategy = await getEthereumExecutionStrategy(context)
    if (executionStrategy === 'batched' && transactionRequest) {
      return new EthereumBatchedSignAndExecuteTask().run(context)
    }
    if (executionStrategy === 'relayed') {
      return new EthereumRelayedSignAndExecuteTask().run(context)
    }
    // Typed data with nothing to send belongs to the relayer. `batched` needs a
    // transaction request and `standard` throws without one, so this is the only
    // path that can execute a signature-only step. It is decided here, not in
    // `getEthereumExecutionStrategy`: before prepare, a caller-intent step that
    // will receive a transaction and one that never will are indistinguishable.
    if (!transactionRequest && step.typedData?.length) {
      return new EthereumRelayedSignAndExecuteTask().run(context)
    }
    return new EthereumStandardSignAndExecuteTask().run(context)
  }
}
