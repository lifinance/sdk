import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import { base64ToUint8Array } from '../utils/base64ToUint8Array.js'
import { getWalletFeature } from '../utils/getWalletFeature.js'
import { withTimeout } from '../utils/withTimeout.js'
import { SolanaWaitForTransactionTask } from './SolanaWaitForTransactionTask.js'
import type { SolanaTaskExtra } from './types.js'

export class SolanaSignAndExecuteTask extends BaseStepExecutionTask<SolanaTaskExtra> {
  readonly type = 'SOLANA_SIGN_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<SolanaTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<SolanaTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, wallet, walletAccount, statusManager, executionOptions } =
      context

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    let transactionRequest: TransactionParameters = {
      data: step.transactionRequest.data,
    }

    if (executionOptions?.updateTransactionRequestHook) {
      const customizedTransactionRequest: TransactionParameters =
        await executionOptions.updateTransactionRequestHook({
          requestType: 'transaction',
          ...transactionRequest,
        })
      transactionRequest = {
        ...transactionRequest,
        ...customizedTransactionRequest,
      }
    }

    if (!transactionRequest.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    // Handle both single transaction (string) and multiple transactions (array)
    const transactionDataArray = Array.isArray(transactionRequest.data)
      ? transactionRequest.data
      : [transactionRequest.data]

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

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    return new SolanaWaitForTransactionTask().execute(context, {
      signedTransactionOutputs,
    })
  }
}
