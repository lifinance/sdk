import type { Client } from '@bigmi/core'
import {
  BaseStepExecutor,
  ChainId,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
} from '@lifi/sdk'
import { getBitcoinPublicClient } from './client/publicClient.js'
import { BitcoinCheckBalanceTask } from './tasks/BitcoinCheckBalanceTask.js'
import { BitcoinPrepareTransactionTask } from './tasks/BitcoinPrepareTransactionTask.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import type { BitcoinStepExecutionTask } from './tasks/BitcoinStepExecutionTask.js'
import { BitcoinWaitForDestinationChainTask } from './tasks/BitcoinWaitForDestinationChainTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'

interface BitcoinStepExecutorOptions extends StepExecutorOptions {
  client: Client
}

export class BitcoinStepExecutor extends BaseStepExecutor {
  private walletClient: Client

  constructor(options: BitcoinStepExecutorOptions) {
    super(options)
    this.walletClient = options.client
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<any> => {
    const publicClient = await getBitcoinPublicClient(
      baseContext.client,
      ChainId.BTC
    )

    const pipeline = new TaskPipeline([
      new BitcoinCheckBalanceTask(),
      new BitcoinPrepareTransactionTask(),
      new BitcoinSignAndExecuteTask() as unknown as BitcoinStepExecutionTask<void>,
      new BitcoinWaitForTransactionTask(),
      new BitcoinWaitForDestinationChainTask(),
    ])

    return {
      ...baseContext,
      pipeline,
      publicClient,
      walletClient: this.walletClient,
    }
  }
}
