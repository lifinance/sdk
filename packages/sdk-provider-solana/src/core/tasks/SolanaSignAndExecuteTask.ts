import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { getTransactionCodec } from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import type { SolanaStepExecutorContext } from '../../types.js'
import { base64ToUint8Array } from '../../utils/base64ToUint8Array.js'
import { getWalletFeature } from '../../utils/getWalletFeature.js'
import { withTimeout } from '../../utils/withTimeout.js'

export class SolanaSignAndExecuteTask extends BaseStepExecutionTask {
  static override readonly name = 'SOLANA_SIGN_AND_EXECUTE' as const
  override readonly taskName = SolanaSignAndExecuteTask.name

  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      wallet,
      walletAccount,
      statusManager,
      executionOptions,
      isBridgeExecution,
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

    // Handle both single transaction (string) and multiple transactions (array)
    const transactionDataArray = Array.isArray(transactionRequestData)
      ? transactionRequestData
      : [transactionRequestData]

    const transactionBytesArray = transactionDataArray.map((data) =>
      base64ToUint8Array(data)
    )

    const signedTransactionOutputs = await withTimeout(
      async () => {
        const { signTransaction } = getWalletFeature(
          wallet,
          SolanaSignTransaction
        )
        // Spread the inputs to sign all transactions at once
        return signTransaction(
          ...transactionBytesArray.map((transaction) => ({
            account: walletAccount,
            transaction,
          }))
        )
      },
      {
        // https://solana.com/docs/advanced/confirmation#transaction-expiration
        // Use 2 minutes to account for fluctuations
        timeout: 120_000,
        errorInstance: new TransactionError(
          LiFiErrorCode.TransactionExpired,
          'Transaction has expired: blockhash is no longer recent enough.'
        ),
      }
    )

    if (signedTransactionOutputs.length === 0) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'No signed transaction returned from signer.'
      )
    }

    const transactionCodec = getTransactionCodec()

    // Decode all signed transactions
    const signedTransactions = signedTransactionOutputs.map((output) =>
      transactionCodec.decode(output.signedTransaction)
    )

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    return {
      status: 'COMPLETED',
      result: { signedTransactions },
    }
  }
}
