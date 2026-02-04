import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getTransactionCodec, type Transaction } from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import { base64ToUint8Array } from '../utils/base64ToUint8Array.js'
import { getWalletFeature } from '../utils/getWalletFeature.js'
import { withTimeout } from '../utils/withTimeout.js'
import type { SolanaTaskExtra } from './types.js'

export interface SolanaSignAndExecuteResult {
  signedTransaction: Transaction
}

export class SolanaSignAndExecuteTask extends BaseStepExecutionTask<
  SolanaTaskExtra,
  SolanaSignAndExecuteResult
> {
  readonly type = 'SOLANA_SIGN_AND_EXECUTE'

  override async shouldRun(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<TaskResult<SolanaSignAndExecuteResult>> {
    const {
      step,
      wallet,
      walletAccount,
      statusManager,
      actionType,
      executionOptions,
    } = context

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

    const transactionBytes = base64ToUint8Array(transactionRequest.data)

    const signedTransactionOutputs = await withTimeout(
      async () => {
        const { signTransaction } = getWalletFeature(
          wallet,
          SolanaSignTransaction
        )
        return signTransaction({
          account: walletAccount,
          transaction: transactionBytes,
        })
      },
      {
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

    context.action = statusManager.updateAction(step, actionType, 'PENDING')

    const transactionCodec = getTransactionCodec()
    const signedTransaction = transactionCodec.decode(
      signedTransactionOutputs[0].signedTransaction
    )

    return {
      status: 'COMPLETED',
      data: { signedTransaction },
    }
  }
}
