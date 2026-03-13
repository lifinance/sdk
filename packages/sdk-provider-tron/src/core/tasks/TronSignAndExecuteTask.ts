import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { TronStepExecutorContext } from '../../types.js'

export class TronSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      wallet,
      statusManager,
      executionOptions,
      isBridgeExecution,
      checkWallet,
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

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    checkWallet(step)

    const unsignedTransaction = JSON.parse(transactionRequestData)

    const signedTransaction = await wallet.signTransaction(unsignedTransaction)

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    return {
      status: 'COMPLETED',
      context: { signedTransaction },
    }
  }
}
