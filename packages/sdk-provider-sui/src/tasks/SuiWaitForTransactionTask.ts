import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { callSuiWithRetry } from '../client/suiClient.js'
import type { SuiTaskExtra } from './types.js'

export class SuiWaitForTransactionTask
  implements ExecutionTask<SuiTaskExtra, void>
{
  readonly type = 'SUI_WAIT_FOR_TRANSACTION'
  readonly displayName = 'Confirm transaction'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context
    return !!action.txHash && action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
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
