import type { ReplacementReason } from '@bigmi/core'
import { waitForTransaction } from '@bigmi/core'
import {
  BaseStepExecutionTask,
  type ExecutionAction,
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
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<BitcoinTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<BitcoinTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<void>> {
    let currentAction = action
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

      currentAction = statusManager.updateAction(step, action.type, 'PENDING', {
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
          action.type,
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
      currentAction = statusManager.updateAction(step, action.type, 'PENDING', {
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
