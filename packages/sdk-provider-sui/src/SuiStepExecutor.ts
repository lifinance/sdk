import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  CheckBalanceTask,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { parseSuiErrors } from './errors/parseSuiErrors.js'
import { SuiSignAndExecuteTask } from './tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from './tasks/SuiWaitForTransactionTask.js'
import type { SuiStepExecutorContext, SuiStepExecutorOptions } from './types.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private wallet: WalletWithRequiredFeatures

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SuiStepExecutorContext> => {
    const { isBridgeExecution } = baseContext
    const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const actionPipelines = new ActionPipelineOrchestrator([
      new TaskPipeline(exchangeActionType, [
        new CheckBalanceTask(),
        new PrepareTransactionTask(),
        new SuiSignAndExecuteTask(),
        new SuiWaitForTransactionTask(),
        new WaitForTransactionStatusTask(),
      ]),
      new TaskPipeline(
        'RECEIVING_CHAIN',
        [new WaitForTransactionStatusTask()],
        () => isBridgeExecution
      ),
    ])

    return {
      ...baseContext,
      actionPipelines,
      wallet: this.wallet,
      parseErrors: parseSuiErrors,
      // Payload shared between tasks
      signedTransaction: undefined,
    }
  }
}
