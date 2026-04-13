import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../../rpc/callTronRpcsWithRetry.js'
import { waitForTronTxConfirmation } from '../../rpc/waitForTronTxConfirmation.js'
import type { TronStepExecutorContext } from '../../types.js'
import { getTronTxLink } from '../../utils/getTronTxLink.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'

export class TronWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: TronStepExecutorContext): Promise<TaskResult> {
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

    const broadcastResult = await callTronRpcsWithRetry(
      client,
      async (tronWeb) => {
        const result = await tronWeb.trx.sendRawTransaction(signedTransaction)

        if (!result.result && String(result.code) !== 'DUP_TRANSACTION_ERROR') {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction broadcast failed: ${result.code || 'Unknown error'}`
          )
        }

        return result
      }
    )

    const txHash = stripHexPrefix(
      broadcastResult.transaction?.txID ?? signedTransaction.txID
    )

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash,
      txLink: getTronTxLink(fromChain, txHash),
    })

    await waitForTronTxConfirmation(client, txHash)

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
