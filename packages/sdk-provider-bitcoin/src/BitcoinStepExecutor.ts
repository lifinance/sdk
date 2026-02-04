import type { Client } from '@bigmi/core'
import {
  type BaseStepExecutionTask,
  BaseStepExecutor,
  ChainId,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
} from '@lifi/sdk'
import { getBitcoinPublicClient } from './client/publicClient.js'
import { parseBitcoinErrors } from './errors/parseBitcoinErrors.js'
import { BitcoinCheckBalanceTask } from './tasks/BitcoinCheckBalanceTask.js'
import { BitcoinPrepareTransactionTask } from './tasks/BitcoinPrepareTransactionTask.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForDestinationChainTask } from './tasks/BitcoinWaitForDestinationChainTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'
import type { BitcoinTaskExtra } from './tasks/types.js'

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
      new BitcoinSignAndExecuteTask() as unknown as BaseStepExecutionTask<
        BitcoinTaskExtra,
        unknown
      >,
      new BitcoinWaitForTransactionTask(),
      new BitcoinWaitForDestinationChainTask(),
    ])

    return {
      ...baseContext,
      pipeline,
      publicClient,
      walletClient: this.walletClient,
      parseErrors: parseBitcoinErrors,
    }
  }
}
