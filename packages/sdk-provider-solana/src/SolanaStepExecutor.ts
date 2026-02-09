import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  CheckBalanceTask,
  LiFiErrorCode,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  type StepExecutorContext,
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
  ): Promise<StepExecutorContext<SolanaTaskExtra>> => {
    const { isBridgeExecution, step } = baseContext
    const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const pipeline = new ActionPipelineOrchestrator<SolanaTaskExtra>([
      new TaskPipeline<SolanaTaskExtra>(exchangeActionType, [
        new CheckBalanceTask<SolanaTaskExtra>(),
        new PrepareTransactionTask<SolanaTaskExtra>(),
        new SolanaSignAndExecuteTask(),
        new SolanaWaitForTransactionTask(),
      ]),
      new TaskPipeline<SolanaTaskExtra>('RECEIVING_CHAIN', [
        new WaitForDestinationChainTask<SolanaTaskExtra>(),
      ]),
    ])

    const walletAccount = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )
    if (!walletAccount) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    return {
      ...baseContext,
      pipeline,
      wallet: this.wallet,
      walletAccount,
      parseErrors: parseSolanaErrors,
    }
  }
}
