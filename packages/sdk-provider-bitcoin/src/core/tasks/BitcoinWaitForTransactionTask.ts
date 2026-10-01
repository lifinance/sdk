import type { ReplacementReason } from '@bigmi/core'
import { waitForTransaction } from '@bigmi/core'
import {
  BaseStepExecutionTask,
  isResendAllowed,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { BitcoinStepExecutorContext } from '../../types.js'

export class BitcoinWaitForTransactionTask extends BaseStepExecutionTask {
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

    // A resume, or "Try again" after a send with an unknown outcome: the
    // bytes may never have reached a node. Send them once more, but only
    // within the age cap, so a page load long after signing cannot execute a
    // swap on an old quote. The same bytes keep the same txid, so a resend
    // can never make the transaction land twice.
    if (
      context.bitcoinSent !== true &&
      isResendAllowed(step.execution?.signedAt)
    ) {
      try {
        await publicClient.sendUTXOTransaction({ hex: txHex })
      } catch {
        // Ignored: an "already" answer, a refusal and a transport error all
        // leave it to the wait below to find the transaction or its
        // replacement.
      }
    }

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
        'User canceled transaction.',
        undefined,
        { final: true }
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
