import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
  type TransactionParameters,
} from '@lifi/sdk'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import { prepareUpdatedStep as prepareUpdatedStepHelper } from './helpers/prepareUpdatedStep.js'
import type { EthereumTaskExtra } from './types.js'

export interface EthereumPrepareTransactionResult {
  transactionRequest: TransactionParameters | undefined
  isRelayerTransaction: boolean
}

export class EthereumPrepareTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  EthereumPrepareTransactionResult
> {
  readonly type = 'ETHEREUM_PREPARE_TRANSACTION'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<EthereumPrepareTransactionResult>> {
    const signedTypedData = context.signedTypedData ?? []
    const {
      client,
      step,
      action,
      actionType,
      allowUserInteraction,
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
        checkClient: (s, a, tid) =>
          checkClientHelper(s, a, tid, {
            getClient: context.getClient,
            setClient: context.setClient,
            statusManager: context.statusManager,
            allowUserInteraction: context.allowUserInteraction,
            switchChain: context.switchChain,
          }),
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
