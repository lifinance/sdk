import type { Client } from '@bigmi/core'
import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  CheckBalanceTask,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  type StepExecutorContext,
  type StepExecutorOptions,
  TaskPipeline,
  WaitForDestinationChainTask,
} from '@lifi/sdk'
import { getBitcoinPublicClient } from './client/publicClient.js'
import { parseBitcoinErrors } from './errors/parseBitcoinErrors.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
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
  ): Promise<StepExecutorContext<BitcoinTaskExtra>> => {
    const { isBridgeExecution, client, fromChain } = baseContext

    const publicClient = await getBitcoinPublicClient(client, fromChain.id)

    const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const pipeline = new ActionPipelineOrchestrator<BitcoinTaskExtra>([
      new TaskPipeline<BitcoinTaskExtra>(exchangeActionType, [
        new CheckBalanceTask<BitcoinTaskExtra>(),
        new PrepareTransactionTask<BitcoinTaskExtra>(),
        new BitcoinSignAndExecuteTask(),
        new BitcoinWaitForTransactionTask(),
      ]),
      new TaskPipeline<BitcoinTaskExtra>('RECEIVING_CHAIN', [
        new WaitForDestinationChainTask<BitcoinTaskExtra>(),
      ]),
    ])

    return {
      ...baseContext,
      pipeline,
      pollingIntervalMs: 10_000,
      walletClient: this.walletClient,
      publicClient,
      parseErrors: parseBitcoinErrors,
    }
  }
}
