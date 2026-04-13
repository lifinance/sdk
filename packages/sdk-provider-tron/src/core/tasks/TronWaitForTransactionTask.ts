import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import { callTronRpcsWithRetry } from '../../rpc/callTronRpcsWithRetry.js'
import type { TronStepExecutorContext } from '../../types.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'
import { TRON_POLL_INTERVAL_MS, TRON_POLL_MAX_RETRIES } from '../constants.js'

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
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}#/transaction/${txHash}`,
    })

    await waitForResult(
      async () => {
        const txInfo = await callTronRpcsWithRetry(client, (tronWeb) =>
          tronWeb.trx.getTransactionInfo(txHash)
        )
        if (txInfo?.id) {
          if (txInfo.receipt?.result === 'FAILED') {
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              `Transaction failed on-chain: ${txInfo.receipt.result}`
            )
          }
          return txInfo
        }
        return undefined
      },
      TRON_POLL_INTERVAL_MS,
      TRON_POLL_MAX_RETRIES
    )

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
