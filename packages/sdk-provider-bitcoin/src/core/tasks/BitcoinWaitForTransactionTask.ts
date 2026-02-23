import type { ReplacementReason } from '@bigmi/core'
import { waitForTransaction } from '@bigmi/core'
import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { BitcoinStepExecutorContext } from '../../types.js'

export class BitcoinWaitForTransactionTask extends BaseStepExecutionTask {
  static override readonly name = 'BITCOIN_WAIT_FOR_TRANSACTION' as const
  override readonly taskName = BitcoinWaitForTransactionTask.name

  async run(context: BitcoinStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      walletClient,
      publicClient,
      checkClient,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    const txHex = action?.txHex
    const txHash = action?.txHash

    if (!txHash || !txHex) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction hash or hex is not set.'
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
