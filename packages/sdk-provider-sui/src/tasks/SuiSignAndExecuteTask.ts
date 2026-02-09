import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { signAndExecuteTransaction } from '@mysten/wallet-standard'
import { SuiWaitForTransactionTask } from './SuiWaitForTransactionTask.js'
import type { SuiTaskExtra } from './types.js'

export class SuiSignAndExecuteTask extends BaseStepExecutionTask<SuiTaskExtra> {
  readonly type = 'SUI_SIGN_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<SuiTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, wallet, statusManager, executionOptions } = context

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

    const transactionRequestData = transactionRequest.data

    if (!transactionRequestData) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    const walletAccount = wallet.accounts?.find(
      (a) => a.address === step.action.fromAddress
    )
    if (!walletAccount) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    // We give users 2 minutes to sign the transaction
    const signedTx = await signAndExecuteTransaction(wallet, {
      account: walletAccount,
      chain: 'sui:mainnet',
      transaction: {
        toJSON: async () => transactionRequestData,
      },
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    return new SuiWaitForTransactionTask().execute(context, {
      signedTx,
    })
  }
}
