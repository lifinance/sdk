import type { ReplacementReason } from '@bigmi/core'
import { waitForTransaction } from '@bigmi/core'
import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { BitcoinTaskExtra } from './types.js'

export class BitcoinWaitForTransactionTask
  implements ExecutionTask<BitcoinTaskExtra, void>
{
  readonly type = 'BITCOIN_WAIT_FOR_TRANSACTION'
  readonly displayName = 'Confirm transaction'

  async shouldRun(context: TaskContext<BitcoinTaskExtra>): Promise<boolean> {
    const { action } = context
    return action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      step,
      statusManager,
      actionType,
      fromChain,
      isBridgeExecution,
      publicClient,
      walletClient,
    } = context

    // txHex from pipeline (Sign task) or from action when we already have txHash (resume)
    const txHex = context.txHex ?? context.action.txHex

    if (!txHex) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Signed transaction hex is missing.'
      )
    }

    let txHash = context.action.txHash

    if (!txHash) {
      txHash = await publicClient.sendUTXOTransaction({
        hex: txHex,
      })

      context.action = statusManager.updateAction(step, actionType, 'PENDING', {
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
        context.action = statusManager.updateAction(
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
      context.action = statusManager.updateAction(step, actionType, 'PENDING', {
        txHash: transaction.txid,
        txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transaction.txid}`,
      })
    }

    if (isBridgeExecution) {
      context.action = statusManager.updateAction(step, actionType, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
