import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Transaction } from '@tronweb3/tronwallet-abstract-adapter'
import { utils } from 'tronweb'
import { callTronRpcsWithRetry } from '../../rpc/callTronRpcsWithRetry.js'
import type { TronStepExecutorContext } from '../../types.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'

export class TronSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      wallet,
      statusManager,
      isBridgeExecution,
      checkWallet,
      client,
    } = context

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

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    checkWallet(step)

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!context.allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const rawDataHex = stripHexPrefix(step.transactionRequest.data as string)

    const contractType =
      (step.transactionRequest.customData?.contractType as string) ??
      'TriggerSmartContract'

    // Re-anchor to a fresh block — a stale `ref_block_hash` falls outside TronLink's
    // recent-block window and surfaces as a generic "Network mismatched" error. Then
    // `newTxID` re-runs the tx through TronWeb's `createTransaction`, dropping the
    // deserializer's non-protobuf artifacts and producing a consistent `txID` /
    // `raw_data_hex` pair.
    const transaction: Transaction = await callTronRpcsWithRetry(
      client,
      async (tronWeb) => {
        const rawData = utils.deserializeTx.deserializeTransaction(
          contractType,
          rawDataHex
        )
        Object.assign(rawData, await tronWeb.trx.getCurrentRefBlockParams())
        return tronWeb.transactionBuilder.newTxID(
          { visible: false, txID: '', raw_data: rawData, raw_data_hex: '' },
          { txLocal: true }
        )
      }
    )

    const signedTransaction = await wallet.signTransaction(transaction)

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    return {
      status: 'COMPLETED',
      context: { signedTransaction },
    }
  }
}
