import {
  BaseStepExecutionTask,
  hasOpenTransaction,
  type TaskResult,
  type TransactionMethodType,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedWaitForTransactionTask } from './EthereumBatchedWaitForTransactionTask.js'
import { EthereumRelayedWaitForTransactionTask } from './EthereumRelayedWaitForTransactionTask.js'
import { EthereumStandardWaitForTransactionTask } from './EthereumStandardWaitForTransactionTask.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'

const TRANSACTION_METHOD_TYPES: readonly TransactionMethodType[] = [
  'standard',
  'batched',
  'relayed',
]

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const { step, statusManager, isBridgeExecution } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    // The lane that sent the open transaction waits for it. The sign task
    // stores that lane in `txType`, and a resume keeps it. The step content
    // cannot always tell it again: a step that prepare sent to the relayer
    // only because it had no `transactionRequest` reads as a standard or a
    // batched step on resume. The guard skips a `txType` left on an action
    // without an open transaction. Routes stored without `txType` derive the
    // lane from the step.
    const storedStrategy =
      hasOpenTransaction(action) &&
      action?.txType &&
      TRANSACTION_METHOD_TYPES.includes(action.txType)
        ? action.txType
        : undefined
    const executionStrategy =
      storedStrategy ?? (await getEthereumExecutionStrategy(context))
    if (executionStrategy === 'batched') {
      return new EthereumBatchedWaitForTransactionTask().run(context)
    }
    if (executionStrategy === 'relayed') {
      return new EthereumRelayedWaitForTransactionTask().run(context)
    }
    return new EthereumStandardWaitForTransactionTask().run(context)
  }
}
