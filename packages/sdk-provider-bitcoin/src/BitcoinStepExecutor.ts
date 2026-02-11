import type { Client } from '@bigmi/core'
import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  CheckBalanceTask,
  LiFiErrorCode,
  type LiFiStepExtended,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TaskPipeline,
  TransactionError,
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
  private client: Client

  constructor(options: BitcoinStepExecutorOptions) {
    super(options)
    this.client = options.client
  }

  checkClient = (step: LiFiStepExtended) => {
    // TODO: check chain and possibly implement chain switch?
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.client.account?.address !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
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
      checkClient: this.checkClient,
      walletClient: this.client,
      publicClient,
      parseErrors: parseBitcoinErrors,
    }
  }
}
