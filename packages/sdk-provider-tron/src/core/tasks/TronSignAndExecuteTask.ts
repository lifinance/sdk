import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Transaction } from '@tronweb3/tronwallet-abstract-adapter'
import { utils } from 'tronweb'
import type { TronStepExecutorContext } from '../../types.js'
import { stripHexPrefix } from '../../utils/stripHexPrefix.js'

export class TronSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    const { step, wallet, statusManager, isBridgeExecution, checkWallet } =
      context

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

    // The API ships the transaction as a raw protobuf hex; TronWeb's wallet adapter
    // needs the decoded `raw_data` plus a `txID`. We decode the hex into raw_data,
    // then compute txID locally from it. Computing rather than trusting an upstream
    // txID also defends against raw_data_hex / txID mismatches.
    const raw_data = utils.deserializeTx.deserializeTransaction(
      contractType,
      rawDataHex
    )

    const transactionPb = utils.transaction.txJsonToPb({
      visible: false,
      raw_data,
    })
    const txID = stripHexPrefix(utils.transaction.txPbToTxID(transactionPb))

    const transaction: Transaction = {
      visible: false,
      txID,
      raw_data,
      raw_data_hex: rawDataHex,
    }

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
