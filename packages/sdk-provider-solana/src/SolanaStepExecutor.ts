import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  CheckBalanceTask,
  LiFiErrorCode,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'
import type {
  SolanaStepExecutorContext,
  SolanaStepExecutorOptions,
} from './types.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SolanaStepExecutorContext> => {
    const { isBridgeExecution, step } = baseContext
    const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const actionPipelines = new ActionPipelineOrchestrator([
      new TaskPipeline(exchangeActionType, [
        new CheckBalanceTask(),
        new PrepareTransactionTask(),
        new SolanaSignAndExecuteTask(),
        new SolanaWaitForTransactionTask(),
        new WaitForTransactionStatusTask(),
      ]),
      new TaskPipeline(
        'RECEIVING_CHAIN',
        [new WaitForTransactionStatusTask()],
        () => isBridgeExecution
      ),
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
      actionPipelines,
      wallet: this.wallet,
      walletAccount,
      parseErrors: parseSolanaErrors,
      // Payload shared between tasks
      signedTransactions: [],
    }
  }
}
