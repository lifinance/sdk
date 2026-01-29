import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { prepareUpdatedStep as prepareUpdatedStepHelper } from './helpers/prepareUpdatedStep.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumPrepareTransactionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_PREPARE_TRANSACTION'
  readonly displayName = 'Prepare transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      action,
      signedTypedData,
      allowUserInteraction,
      checkClient,
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

    context.transactionRequest = prepared.transactionRequest
    context.isRelayerTransaction = prepared.isRelayerTransaction
    return { status: 'COMPLETED' }
  }
}
