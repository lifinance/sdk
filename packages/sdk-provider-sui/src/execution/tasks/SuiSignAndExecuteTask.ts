import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { signAndExecuteTransaction } from '@mysten/wallet-standard'
import type { SuiStepExecutorContext } from '../../types.js'

export class SuiSignAndExecuteTask extends BaseStepExecutionTask {
  static override readonly name = 'SUI_SIGN_AND_EXECUTE' as const
  override readonly taskName = SuiSignAndExecuteTask.name

  async run(context: SuiStepExecutorContext): Promise<TaskResult> {
    const { step, wallet, statusManager, executionOptions, isBridgeExecution } =
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

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

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
    context.signedTransaction = await signAndExecuteTransaction(wallet, {
      account: walletAccount,
      chain: 'sui:mainnet',
      transaction: {
        toJSON: async () => transactionRequestData,
      },
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    return {
      status: 'COMPLETED',
    }
  }
}
