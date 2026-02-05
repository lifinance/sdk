import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { callSuiWithRetry } from '../client/suiClient.js'
import type { SuiTaskExtra } from './types.js'

export class SuiWaitForTransactionTask extends BaseStepExecutionTask<
  SuiTaskExtra,
  void
> {
  readonly type = 'SUI_WAIT_FOR_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<SuiTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context
    const digest = action.txHash

    if (!digest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Transaction hash is undefined.'
      )
    }

    const result = await callSuiWithRetry(client, (client) =>
      client.waitForTransaction({
        digest,
        options: {
          showEffects: true,
        },
      })
    )

    if (result.effects?.status.status !== 'success') {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${result.effects?.status.error}`
      )
    }

    //  Transaction has been confirmed
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: result.digest,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${result.digest}`,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
