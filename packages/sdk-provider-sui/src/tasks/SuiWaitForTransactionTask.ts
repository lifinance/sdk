import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { SuiSignAndExecuteTransactionOutput } from '@mysten/wallet-standard'
import { callSuiWithRetry } from '../client/suiClient.js'
import type { SuiTaskExtra } from './types.js'

export class SuiWaitForTransactionTask extends BaseStepExecutionTask<SuiTaskExtra> {
  override async shouldRun(
    context: TaskContext<SuiTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<SuiTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTx: SuiSignAndExecuteTransactionOutput
    }
  ): Promise<TaskResult> {
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context
    const { signedTx } = payload

    const result = await callSuiWithRetry(client, (client) =>
      client.waitForTransaction({
        digest: signedTx.digest,
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

    // Transaction has been confirmed and we can update the action
    action = statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: result.digest,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${result.digest}`,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
