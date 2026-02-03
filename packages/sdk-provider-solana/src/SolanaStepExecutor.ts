import {
  BaseStepExecutor,
  LiFiErrorCode,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { SolanaCheckBalanceTask } from './tasks/SolanaCheckBalanceTask.js'
import { SolanaPrepareTransactionTask } from './tasks/SolanaPrepareTransactionTask.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import type { SolanaStepExecutionTask } from './tasks/SolanaStepExecutionTask.js'
import { SolanaWaitForDestinationChainTask } from './tasks/SolanaWaitForDestinationChainTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'
import type { SolanaStepExecutorOptions } from './types.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<any> => {
    const walletAccount = this.wallet.accounts.find(
      (account) => account.address === baseContext.step.action.fromAddress
    )

    if (!walletAccount) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    const pipeline = new TaskPipeline([
      new SolanaCheckBalanceTask(),
      new SolanaPrepareTransactionTask(),
      new SolanaSignAndExecuteTask() as unknown as SolanaStepExecutionTask<void>,
      new SolanaWaitForTransactionTask(),
      new SolanaWaitForDestinationChainTask(),
    ])

    return {
      ...baseContext,
      pipeline,
      walletAccount,
    }
  }
}
