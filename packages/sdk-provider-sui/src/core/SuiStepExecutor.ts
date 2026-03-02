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

  checkWallet = (step: LiFiStepExtended) => {
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

  override createPipeline = (context: SuiStepExecutorContext) => {
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

    const taskName =
      swapOrBridgeAction?.txHash && swapOrBridgeAction?.status === 'DONE'
        ? WaitForTransactionStatusTask.name
        : CheckBalanceTask.name

    const firstTaskIndex = tasks.findIndex(
      (task) => task.constructor.name === taskName
    )

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }
}
