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
    const { action, isBridgeExecution } = context.extra
    if (!action.txHash) {
      return false
    }
    // For bridge steps we mark the source action as DONE after finality
    if (isBridgeExecution && action.status === 'DONE') {
      return false
    }
    return true
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { client, step, extra } = context
    const digest = extra.action.txHash

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

    // Ensure tx details are present
    extra.action = extra.statusManager.updateAction(
      step,
      extra.actionType,
      'PENDING',
      {
        txHash: result.digest,
        txLink: `${extra.fromChain.metamask.blockExplorerUrls[0]}txblock/${result.digest}`,
      }
    )

    if (extra.isBridgeExecution) {
      extra.action = extra.statusManager.updateAction(
        step,
        extra.actionType,
        'DONE'
      )
    }

    return { status: 'COMPLETED' }
  }
}
