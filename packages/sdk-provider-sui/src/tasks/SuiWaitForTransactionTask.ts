import {
  BaseStepExecutionTask,
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

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !!action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<SuiTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      action,
      statusManager,
      actionType,
      fromChain,
      isBridgeExecution,
    } = context
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
    context.action = statusManager.updateAction(step, actionType, 'PENDING', {
      txHash: result.digest,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${result.digest}`,
    })

    if (isBridgeExecution) {
      context.action = statusManager.updateAction(step, actionType, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
