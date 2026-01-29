import type {
  ExecutionTask,
  TaskContext,
  TaskResult,
  TransactionParameters,
} from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import {
  signAndExecuteTransaction,
  type WalletWithRequiredFeatures,
} from '@mysten/wallet-standard'
import type { SuiTaskExtra } from './types.js'

function assertWalletMatchesStep(
  wallet: WalletWithRequiredFeatures,
  fromAddress: string
): void {
  if (!wallet.accounts?.some?.((account) => account.address === fromAddress)) {
    throw new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
    )
  }
}

export class SuiSignAndExecuteTask
  implements ExecutionTask<SuiTaskExtra, { suiTxDigest: string }>
{
  readonly type = 'SUI_SIGN_AND_EXECUTE'
  readonly displayName = 'Send transaction'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    return (
      !context.extra.action.txHash && context.extra.action.status !== 'DONE'
    )
  }

  async execute(
    context: TaskContext<SuiTaskExtra>
  ): Promise<TaskResult<{ suiTxDigest: string }>> {
    const { step, extra } = context

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    let transactionRequest: TransactionParameters = {
      data: step.transactionRequest.data,
    }

    if (extra.executionOptions?.updateTransactionRequestHook) {
      const customizedTransactionRequest: TransactionParameters =
        await extra.executionOptions.updateTransactionRequestHook({
          requestType: 'transaction',
          ...transactionRequest,
        })

      transactionRequest = {
        ...transactionRequest,
        ...customizedTransactionRequest,
      }
    }

    const transactionRequestData = transactionRequest.data

    if (!transactionRequestData) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    assertWalletMatchesStep(extra.wallet, step.action.fromAddress!)

    const account = extra.wallet.accounts.find(
      (a) => a.address === step.action.fromAddress
    )

    if (!account) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    const signedTx = await signAndExecuteTransaction(extra.wallet, {
      account,
      // Keep current behavior (mainnet). Can be made dynamic later.
      chain: 'sui:mainnet',
      transaction: {
        toJSON: async () => transactionRequestData,
      },
    })

    // Persist txHash immediately so we can resume waiting if needed.
    extra.action = extra.statusManager.updateAction(
      step,
      extra.actionType,
      'PENDING',
      {
        txHash: signedTx.digest,
        txLink: `${extra.fromChain.metamask.blockExplorerUrls[0]}txblock/${signedTx.digest}`,
      }
    )

    return { status: 'COMPLETED', data: { suiTxDigest: signedTx.digest } }
  }
}
