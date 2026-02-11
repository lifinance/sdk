import type { Client } from '@bigmi/core'
import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  CheckBalanceTask,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { getBitcoinPublicClient } from './client/publicClient.js'
import { parseBitcoinErrors } from './errors/parseBitcoinErrors.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'
import type { BitcoinStepExecutorContext } from './types.js'

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
  ): Promise<BitcoinStepExecutorContext> => {
    const { isBridgeExecution, client, fromChain } = baseContext

    const publicClient = await getBitcoinPublicClient(client, fromChain.id)

    const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const actionPipelines = new ActionPipelineOrchestrator([
      new TaskPipeline(exchangeActionType, [
        new CheckBalanceTask(),
        new PrepareTransactionTask(),
        new BitcoinSignAndExecuteTask(),
        new BitcoinWaitForTransactionTask(),
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
      pollingIntervalMs: 10_000,
      walletClient: this.walletClient,
      publicClient,
      parseErrors: parseBitcoinErrors,
    }
  }
}
