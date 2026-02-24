import {
  BaseStepExecutor,
  CheckBalanceTask,
  type LiFiStepExtended,
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

  getFirstTaskName = (step: LiFiStepExtended, isBridgeExecution: boolean) => {
    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!swapOrBridgeAction?.txHash) {
      return CheckBalanceTask.name
    }
    return WaitForTransactionStatusTask.name
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SuiStepExecutorContext> => {
    const { step, isBridgeExecution } = baseContext

    const pipeline = new TaskPipeline([
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new SuiSignAndExecuteTask(),
      new SuiWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ])

    const firstTaskName = this.getFirstTaskName(step, isBridgeExecution)

    return {
      ...baseContext,
      pipeline,
      firstTaskName,
      wallet: this.wallet,
      parseErrors: parseSuiErrors,
      outputs: {},
    }
  }
}
