import type { ReplacementReason } from '@bigmi/core'
import { waitForTransaction } from '@bigmi/core'
import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { BitcoinStepExecutorContext } from '../types.js'

export class BitcoinWaitForTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: BitcoinStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  async run(
    context: BitcoinStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      walletClient,
      publicClient,
      checkClient,
    } = context

    const txHex = action.txHex
    const txHash = action.txHash

    if (!txHash) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction hash is not found.'
      )
    }

    checkClient(step)

    let replacementReason: ReplacementReason | undefined
    const transaction = await waitForTransaction(publicClient, {
      txId: txHash,
      txHex,
      senderAddress: walletClient.account?.address,
      onReplaced: (response) => {
        replacementReason = response.reason
        statusManager.updateAction(step, action.type, 'PENDING', {
          txHash: response.transaction.txid,
          txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.txid}`,
        })
      },
    })

    if (replacementReason === 'cancelled') {
      throw new TransactionError(
        LiFiErrorCode.TransactionCanceled,
        'User canceled transaction.'
      )
    }

    if (transaction.txid !== txHash) {
      statusManager.updateAction(step, action.type, 'PENDING', {
        txHash: transaction.txid,
        txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transaction.txid}`,
      })
    }

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
