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
import type { SuiTaskExtra } from './types.js'

export class SuiSignAndExecuteTask extends BaseStepExecutionTask<
  SuiTaskExtra,
  void
> {
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
  ): Promise<TaskResult<void>> {
    const { step, wallet, statusManager, fromChain } = context

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

    // We give users 2 minutes to sign the transaction
    const signedTx = await signAndExecuteTransaction(wallet, {
      account: context.getWalletAccount(),
      chain: 'sui:mainnet',
      transaction: {
        toJSON: async () => transactionRequestData,
      },
    })

    // Persist txHash immediately so we can resume waiting if needed.
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: signedTx.digest,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${signedTx.digest}`,
    })

    return { status: 'COMPLETED' }
  }
}
