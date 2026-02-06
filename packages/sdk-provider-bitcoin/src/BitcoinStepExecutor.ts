import type { Client } from '@bigmi/core'
import {
  BaseStepExecutor,
  ChainId,
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
    const publicClient = await getBitcoinPublicClient(
      baseContext.client,
      ChainId.BTC
    )

    const pipeline = new TaskPipeline([
      new CheckBalanceTask<BitcoinTaskExtra>(),
      new PrepareTransactionTask<BitcoinTaskExtra>(),
      new BitcoinSignAndExecuteTask(),
      new WaitForDestinationChainTask<BitcoinTaskExtra>(),
    ])

    return {
      ...baseContext,
      pipeline,
      publicClient,
      walletClient: this.walletClient,
      getWalletAddress: () => {
        const address = this.walletClient.account?.address
        if (!address) {
          throw new Error('Wallet account is not available.')
        }
        return address
      },
      parseErrors: parseBitcoinErrors,
    }
  }
}
