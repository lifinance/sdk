import {
  BaseStepExecutor,
  CheckBalanceTask,
  type ExecutionAction,
  hasOpenTransaction,
  LiFiErrorCode,
  type LiFiStepExtended,
  PrepareTransactionTask,
  type SDKError,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { parseSolanaErrors } from '../errors/parseSolanaErrors.js'
import type {
  SolanaStepExecutorContext,
  SolanaStepExecutorOptions,
} from '../types.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet
  private skipSimulation: boolean

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
    this.skipSimulation = options.skipSimulation ?? false
  }

  getWalletAccount = (step: LiFiStepExtended): WalletAccount => {
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
    // The account is resolved by the sign task, not here: a resume that only
    // waits must not fail because the wallet has not reconnected yet.
    return {
      ...baseContext,
      wallet: this.wallet,
      getWalletAccount: this.getWalletAccount,
      skipSimulation: this.skipSimulation,
    }
  }

  override createPipeline = (
    context: SolanaStepExecutorContext
  ): TaskPipeline => {
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

    // Three-way, as Stellar and Bitcoin do. An open transaction - a broadcast
    // signature, or signed bytes that may have been sent - resumes at the
    // wait task, which looks it up and resends the same bytes. Starting at
    // CheckBalanceTask would fetch a new quote and sign a second transaction
    // while the first can still land. A same-chain swap stays PENDING with
    // its signature until the LI.FI status is DONE, so this is the common
    // reload.
    const firstTask = hasOpenTransaction(swapOrBridgeAction)
      ? swapOrBridgeAction?.status === 'DONE'
        ? WaitForTransactionStatusTask
        : SolanaWaitForTransactionTask
      : CheckBalanceTask

    // Compare classes, not names: a minifier can give two task classes the
    // same name.
    const firstTaskIndex = tasks.findIndex(
      (task) => task.constructor === firstTask
    )
    if (firstTaskIndex === -1) {
      throw new TransactionError(
        LiFiErrorCode.InternalError,
        'SolanaStepExecutor.createPipeline: first task not found'
      )
    }

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }
}
