import {
  BaseStepExecutor,
  type StepExecutorBaseContext,
  TaskPipeline,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { SuiCheckBalanceTask } from './tasks/SuiCheckBalanceTask.js'
import { SuiPrepareTransactionTask } from './tasks/SuiPrepareTransactionTask.js'
import { SuiSignAndExecuteTask } from './tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForDestinationChainTask } from './tasks/SuiWaitForDestinationChainTask.js'
import { SuiWaitForTransactionTask } from './tasks/SuiWaitForTransactionTask.js'
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
      new SuiCheckBalanceTask(),
      new SuiPrepareTransactionTask(),
      new SuiSignAndExecuteTask(),
      new SuiWaitForTransactionTask(),
      new SuiWaitForDestinationChainTask(),
    ])

    return {
      ...baseContext,
      pipeline,
      wallet: this.wallet,
    }
  }
}
