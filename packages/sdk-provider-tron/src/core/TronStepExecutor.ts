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
import type { Adapter } from '@tronweb3/tronwallet-abstract-adapter'
import { parseTronErrors } from '../errors/parseTronErrors.js'
import type {
  TronStepExecutorContext,
  TronStepExecutorOptions,
} from '../types.js'
import { TronSignAndExecuteTask } from './tasks/TronSignAndExecuteTask.js'
import { TronWaitForTransactionTask } from './tasks/TronWaitForTransactionTask.js'

export class TronStepExecutor extends BaseStepExecutor {
  private wallet: Adapter

  constructor(options: TronStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  checkWallet = (step: LiFiStepExtended) => {
    const address = this.wallet.address
    if (address && address !== step.action.fromAddress) {
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
  ): Promise<SDKError> => parseTronErrors(error, step, action)

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<TronStepExecutorContext> => {
    return {
      ...baseContext,
      wallet: this.wallet,
      checkWallet: this.checkWallet,
    }
  }

  override createPipeline = (context: TronStepExecutorContext) => {
    const { step, isBridgeExecution } = context

    const tasks = [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new TronSignAndExecuteTask(),
      new TronWaitForTransactionTask(),
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
