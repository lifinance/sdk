import type {
  ExecutionTask,
  TaskContext,
  TaskResult,
  TransactionParameters,
} from '@lifi/sdk'
import { prepareUpdatedStep as prepareUpdatedStepHelper } from './helpers/prepareUpdatedStep.js'
import type { EthereumTaskExtra } from './types.js'

export interface EthereumPrepareTransactionResult {
  transactionRequest: TransactionParameters | undefined
  isRelayerTransaction: boolean
}

export class EthereumPrepareTransactionTask
  implements ExecutionTask<EthereumTaskExtra, EthereumPrepareTransactionResult>
{
  readonly type = 'ETHEREUM_PREPARE_TRANSACTION'
  readonly displayName = 'Prepare transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<EthereumPrepareTransactionResult>> {
    const {
      client,
      step,
      action,
      actionType,
      signedTypedData,
      allowUserInteraction,
      checkClient,
      statusManager,
    } = context

    const prepared = await prepareUpdatedStepHelper(
      client,
      step,
      action,
      signedTypedData,
      {
        statusManager: context.statusManager,
        executionOptions: context.executionOptions,
        checkClient,
        allowUserInteraction,
        ethereumClient: context.ethereumClient,
      }
    )

    if (!prepared) {
      return { status: 'PAUSED' }
    }

    context.action = statusManager.updateAction(
      step,
      actionType,
      'ACTION_REQUIRED'
    )

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return {
      status: 'COMPLETED',
      data: {
        transactionRequest: prepared.transactionRequest,
        isRelayerTransaction: prepared.isRelayerTransaction,
      },
    }
  }
}
