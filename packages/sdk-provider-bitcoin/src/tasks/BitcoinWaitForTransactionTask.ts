import type { ReplacementReason } from '@bigmi/core'
import { waitForTransaction } from '@bigmi/core'
import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { BitcoinTaskExtra } from './types.js'

export class BitcoinWaitForTransactionTask extends BaseStepExecutionTask<
  BitcoinTaskExtra,
  void
> {
  readonly type = 'BITCOIN_WAIT_FOR_TRANSACTION'

  override async shouldRun(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<boolean> {
    return context.isTransactionExecuted() && !context.isTransactionConfirmed()
  }

  protected override async run(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<TaskResult<void>> {
    const actionType = context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    let currentAction = context.getOrCreateAction(actionType)
    const {
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      publicClient,
      walletClient,
    } = context

    // txHex from pipeline (Sign task) or from action when we already have txHash (resume)
    const txHex = context.txHex ?? currentAction.txHex

    if (!txHex) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Signed transaction hex is missing.'
      )
    }

    let txHash = currentAction.txHash

    if (!txHash) {
      txHash = await publicClient.sendUTXOTransaction({
        hex: txHex,
      })

      currentAction = statusManager.updateAction(step, actionType, 'PENDING', {
        txHash,
        txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
        txHex,
      })
    }

    let replacementReason: ReplacementReason | undefined
    const transaction = await waitForTransaction(publicClient, {
      txId: txHash,
      txHex,
      senderAddress: walletClient.account?.address,
      onReplaced: (response) => {
        replacementReason = response.reason
        currentAction = statusManager.updateAction(
          step,
          actionType,
          'PENDING',
          {
            txHash: response.transaction.txid,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.txid}`,
          }
        )
      },
    })

    if (replacementReason === 'cancelled') {
      throw new TransactionError(
        LiFiErrorCode.TransactionCanceled,
        'User canceled transaction.'
      )
    }

    if (transaction.txid !== txHash) {
      currentAction = statusManager.updateAction(step, actionType, 'PENDING', {
        txHash: transaction.txid,
        txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transaction.txid}`,
      })
    }

    if (isBridgeExecution) {
      statusManager.updateAction(step, actionType, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
