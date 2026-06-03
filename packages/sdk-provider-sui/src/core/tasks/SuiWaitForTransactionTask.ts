import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { callSuiWithRetry } from '../../client/suiClient.js'
import type { SuiStepExecutorContext } from '../../types.js'

export class SuiWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SuiStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      signedTransaction,
    } = context

    if (!signedTransaction) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transaction is not found.'
      )
    }

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    const result = await callSuiWithRetry(client, (client) =>
      client.waitForTransaction({
        digest: signedTransaction.digest,
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
