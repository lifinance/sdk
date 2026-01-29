import type {
  ExecutionAction,
  ExecutionTask,
  LiFiStepExtended,
  TaskContext,
  TaskResult,
} from '@lifi/sdk'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import { prepareUpdatedStep as prepareUpdatedStepHelper } from './helpers/prepareUpdatedStep.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumPrepareTransactionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_PREPARE_TRANSACTION'
  readonly displayName = 'Prepare transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context.extra
    return !action.txHash && !action.taskId
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, extra, allowUserInteraction } = context

    const checkClient = (
      s: LiFiStepExtended,
      a: ExecutionAction,
      targetChainId?: number
    ) => checkClientHelper(s, a, targetChainId, extra.checkClientDeps)

    const prepared = await prepareUpdatedStepHelper(
      client,
      step,
      extra.action,
      extra.signedTypedData,
      {
        statusManager: extra.statusManager,
        executionOptions: extra.executionOptions,
        checkClient,
        allowUserInteraction,
        ethereumClient: extra.ethereumClient,
      }
    )

    if (!prepared) {
      return { status: 'PAUSED' }
    }

    extra.transactionRequest = prepared.transactionRequest
    extra.isRelayerTransaction = prepared.isRelayerTransaction
    return { status: 'COMPLETED' }
  }
}
