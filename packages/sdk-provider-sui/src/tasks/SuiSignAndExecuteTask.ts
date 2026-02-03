import type { TaskContext, TaskResult, TransactionParameters } from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import {
  signAndExecuteTransaction,
  type WalletAccount,
  type WalletWithRequiredFeatures,
} from '@mysten/wallet-standard'
import { SuiStepExecutionTask } from './SuiStepExecutionTask.js'
import type { SuiTaskExtra } from './types.js'

function getWalletAccountForStep(
  wallet: WalletWithRequiredFeatures,
  fromAddress: string
): WalletAccount {
  const account = wallet.accounts?.find((a) => a.address === fromAddress)
  if (!account) {
    throw new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
    )
  }
  return account
}

export class SuiSignAndExecuteTask extends SuiStepExecutionTask<void> {
  readonly type = 'SUI_SIGN_AND_EXECUTE'

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<SuiTaskExtra>
  ): Promise<TaskResult<void>> {
    const { step, wallet, statusManager, actionType, fromChain } = context

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    let transactionRequest: TransactionParameters = {
      data: step.transactionRequest.data,
    }

    if (context.executionOptions?.updateTransactionRequestHook) {
      const customizedTransactionRequest: TransactionParameters =
        await context.executionOptions.updateTransactionRequestHook({
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

    const account = getWalletAccountForStep(wallet, step.action.fromAddress!)

    // We give users 2 minutes to sign the transaction
    const signedTx = await signAndExecuteTransaction(wallet, {
      account,
      chain: 'sui:mainnet',
      transaction: {
        toJSON: async () => transactionRequestData,
      },
    })

    // Persist txHash immediately so we can resume waiting if needed.
    context.action = statusManager.updateAction(step, actionType, 'PENDING', {
      txHash: signedTx.digest,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${signedTx.digest}`,
    })

    return { status: 'COMPLETED' }
  }
}
