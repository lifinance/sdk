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
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import { parseSuiErrors } from '../errors/parseSuiErrors.js'
import type {
  SuiStepExecutorContext,
  SuiStepExecutorOptions,
} from '../types.js'
import { SuiSignAndExecuteTask } from './tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from './tasks/SuiWaitForTransactionTask.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private client: ClientWithCoreApi
  private signer: Signer

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.client = options.client
    this.signer = options.signer
  }

  checkWallet = (step: LiFiStepExtended): void => {
    // Prevent execution of the quote by wallet different from the one which requested the quote
    const address = this.signer.toSuiAddress()
    if (address !== step.action.fromAddress) {
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
  ): Promise<SDKError> => parseSuiErrors(error, step, action)

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SuiStepExecutorContext> => {
    return {
      ...baseContext,
      suiClient: this.client,
      signer: this.signer,
      checkWallet: this.checkWallet,
    }
  }

  override createPipeline = (context: SuiStepExecutorContext): TaskPipeline => {
    const { step, isBridgeExecution } = context

    const tasks = [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new SuiSignAndExecuteTask(),
      new SuiWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ]

    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    // A transaction signed for this action may still land (`txHex` from
    // signing, `txHash` after execution). Resume at the confirmation wait:
    // re-preparing or re-signing could execute the swap twice. A final failure
    // is not open, so "Try again" signs anew.
    const firstTask = hasOpenTransaction(swapOrBridgeAction)
      ? swapOrBridgeAction?.status === 'DONE'
        ? WaitForTransactionStatusTask
        : SuiWaitForTransactionTask
      : CheckBalanceTask

    // Compare classes, not names: a minifier can give two task classes the
    // same name.
    const firstTaskIndex = tasks.findIndex(
      (task) => task.constructor === firstTask
    )
    if (firstTaskIndex === -1) {
      throw new TransactionError(
        LiFiErrorCode.InternalError,
        'SuiStepExecutor.createPipeline: first task not found'
      )
    }

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }
}
