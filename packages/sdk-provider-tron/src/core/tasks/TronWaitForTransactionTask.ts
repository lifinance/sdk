import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type SDKClient,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { TronWeb } from 'tronweb'
import {
  callTronRpcsWithRetry,
  getTronWebInstance,
} from '../../rpc/callTronRpcsWithRetry.js'
import type { TronStepExecutorContext } from '../../types.js'

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

    const tronWeb = await getTronWebInstance(client)
    const broadcastResult =
      await tronWeb.trx.sendRawTransaction(signedTransaction)

    if (!broadcastResult.result) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction broadcast failed: ${broadcastResult.code || 'Unknown error'}`
      )
    }

    const txHash = broadcastResult.transaction.txID

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}#/transaction/${txHash}`,
    })

    await waitForTronConfirmation(client, txHash)

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}

async function waitForTronConfirmation(
  client: SDKClient,
  txHash: string,
  maxRetries = 20,
  intervalMs = 3000
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const txInfo = await callTronRpcsWithRetry(client, (tronWeb: TronWeb) =>
        tronWeb.trx.getTransactionInfo(txHash)
      )

      if (txInfo?.id) {
        if (txInfo.receipt?.result === 'FAILED') {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction failed on-chain: ${txInfo.receipt.result}`
          )
        }
        return
      }
    } catch (error) {
      if (error instanceof TransactionError) {
        throw error
      }
      // Transaction info not yet available, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new TransactionError(
    LiFiErrorCode.TransactionFailed,
    'Transaction confirmation timeout.'
  )
}
