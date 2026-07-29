import {
  BaseStepExecutor,
  CheckBalanceTask,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type SDKError,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { parseStellarErrors } from '../errors/parseStellarErrors.js'
import type {
  StellarStepExecutorContext,
  StellarStepExecutorOptions,
  StellarWallet,
} from '../types.js'
import { StellarCheckAllowanceTask } from './tasks/StellarCheckAllowanceTask.js'
import { StellarPrepareTransactionTask } from './tasks/StellarPrepareTransactionTask.js'
import { StellarSetAllowanceTask } from './tasks/StellarSetAllowanceTask.js'
import { StellarSignAndExecuteTask } from './tasks/StellarSignAndExecuteTask.js'
import { StellarWaitForTransactionTask } from './tasks/StellarWaitForTransactionTask.js'

export class StellarStepExecutor extends BaseStepExecutor {
  private wallet: StellarWallet
  private networkPassphrase: string
  private approvalSpenderOverride?: string

  constructor(options: StellarStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
    this.networkPassphrase = options.networkPassphrase
    this.approvalSpenderOverride = options.approvalSpenderOverride
  }

  checkWallet = (step: LiFiStepExtended): void => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.wallet.address !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
  }

  override parseErrors = (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ): Promise<SDKError> => parseStellarErrors(error, step, action)

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<StellarStepExecutorContext> => {
    return {
      ...baseContext,
      pollingIntervalMs: 3_000,
      wallet: this.wallet,
      networkPassphrase: this.networkPassphrase,
      approvalSpenderOverride: this.approvalSpenderOverride,
      checkWallet: this.checkWallet,
    }
  }

  override createPipeline = (
    context: StellarStepExecutorContext
  ): TaskPipeline => {
    const { step, isBridgeExecution } = context

    // Order is load-bearing: the allowance tasks must complete before the
    // transaction is prepared. Granting an allowance submits a transaction that
    // consumes the sender's sequence number, and the backend builds the route
    // envelope from a live account read — so an envelope prepared first would be
    // invalidated by the approval that follows it.
    const tasks = [
      new CheckBalanceTask(),
      new StellarCheckAllowanceTask(),
      new StellarSetAllowanceTask(),
      new StellarPrepareTransactionTask(),
      new StellarSignAndExecuteTask(),
      new StellarWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ]

    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    // Three-way entry, as Bitcoin does. Stellar derives and persists the
    // transaction hash BEFORE submitting, so a hash on the action means an
    // envelope was signed and very likely broadcast. Resuming such a step at
    // CheckBalanceTask would re-prepare, re-sign and submit a SECOND
    // transaction — executing the swap twice. Resume at the confirmation poll
    // instead and let the already-broadcast transaction settle.
    const taskName = swapOrBridgeAction?.txHash
      ? swapOrBridgeAction.status === 'DONE'
        ? WaitForTransactionStatusTask.name
        : StellarWaitForTransactionTask.name
      : CheckBalanceTask.name

    const firstTaskIndex = tasks.findIndex(
      (task) => task.constructor.name === taskName
    )

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }
}
