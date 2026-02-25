import {
  BaseStepExecutor,
  CheckBalanceTask,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { parseSuiErrors } from '../errors/parseSuiErrors.js'
import type {
  SuiStepExecutorContext,
  SuiStepExecutorOptions,
} from '../types.js'
import { SuiSignAndExecuteTask } from './tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from './tasks/SuiWaitForTransactionTask.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private wallet: WalletWithRequiredFeatures

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SuiStepExecutorContext> => {
    return {
      ...baseContext,
      wallet: this.wallet,
      parseErrors: parseSuiErrors,
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

    const taskClassName = swapOrBridgeAction?.txHash
      ? WaitForTransactionStatusTask
      : CheckBalanceTask

    const firstTaskIndex = tasks.findIndex(
      (task) => task instanceof taskClassName
    )

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }
}
