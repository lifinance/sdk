import {
  BaseStepExecutor,
  CheckBalanceTask,
  LiFiErrorCode,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
  WaitForDestinationChainTask,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'
import type { SolanaTaskExtra } from './tasks/types.js'
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
      new CheckBalanceTask<SolanaTaskExtra>(),
      new PrepareTransactionTask<SolanaTaskExtra>(),
      new SolanaSignAndExecuteTask() as any, // TODO: type this
      new SolanaWaitForTransactionTask(),
      new WaitForDestinationChainTask<SolanaTaskExtra>(),
    ])

    return {
      ...baseContext,
      pipeline,
      walletAccount,
      getWalletAddress: () => walletAccount.address,
      parseErrors: parseSolanaErrors,
    }
  }
}
