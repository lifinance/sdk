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
    const { action } = context
    return !action.txHash && !action.taskId
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
      checkClientDeps,
    } = context

    const checkClient = (
      s: LiFiStepExtended,
      a: ExecutionAction,
      targetChainId?: number
    ) => checkClientHelper(s, a, targetChainId, checkClientDeps)

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
