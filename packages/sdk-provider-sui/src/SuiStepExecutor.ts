import {
  BaseStepExecutor,
  CheckBalanceTask,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  TaskPipeline,
  WaitForDestinationChainTask,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { parseSuiErrors } from './errors/parseSuiErrors.js'
import { SuiSignAndExecuteTask } from './tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from './tasks/SuiWaitForTransactionTask.js'
import type { SuiTaskExtra } from './tasks/types.js'
import type { SuiStepExecutorOptions } from './types.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private wallet: WalletWithRequiredFeatures

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<any> => {
    const pipeline = new TaskPipeline([
      new CheckBalanceTask<SuiTaskExtra>(),
      new PrepareTransactionTask<SuiTaskExtra>(),
      new SuiSignAndExecuteTask(),
      new SuiWaitForTransactionTask(),
      new WaitForDestinationChainTask<SuiTaskExtra>(),
    ])

    return {
      ...baseContext,
      pipeline,
      wallet: this.wallet,
      getWalletAddress: () => baseContext.step.action.fromAddress!,
      parseErrors: parseSuiErrors,
    }
  }
}
