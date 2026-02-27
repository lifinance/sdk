import {
  BaseStepExecutor,
  CheckBalanceTask,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  PrepareTransactionTask,
  type SDKError,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { parseSolanaErrors } from '../errors/parseSolanaErrors.js'
import type {
  SolanaStepExecutorContext,
  SolanaStepExecutorOptions,
} from '../types.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  getWalletAccount = (step: LiFiStepExtended) => {
    const account = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )

    if (!account) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    return account
  }

  override parseErrors = (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ): Promise<SDKError> => parseSolanaErrors(error, step, action)

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SolanaStepExecutorContext> => {
    const { step } = baseContext

    const walletAccount = this.getWalletAccount(step)

    return {
      ...baseContext,
      wallet: this.wallet,
      walletAccount,
    }
  }

  override createPipeline = (context: SolanaStepExecutorContext) => {
    const { step, isBridgeExecution } = context

    const tasks = [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new SolanaSignAndExecuteTask(),
      new SolanaWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ]

    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    const taskClassName =
      swapOrBridgeAction?.txHash && swapOrBridgeAction?.status === 'DONE'
        ? WaitForTransactionStatusTask
        : CheckBalanceTask

    const firstTaskIndex = tasks.findIndex(
      (task) => task instanceof taskClassName
    )

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }
}
