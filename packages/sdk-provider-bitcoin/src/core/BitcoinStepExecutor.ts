import type { Client } from '@bigmi/core'
import {
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
import { getBitcoinPublicClient } from '../client/publicClient.js'
import { parseBitcoinErrors } from '../errors/parseBitcoinErrors.js'
import type { BitcoinStepExecutorContext } from '../types.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'

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

  getFirstTaskName = (step: LiFiStepExtended, isBridgeExecution: boolean) => {
    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!swapOrBridgeAction?.txHash) {
      return CheckBalanceTask.name
    }

    return swapOrBridgeAction?.status !== 'DONE'
      ? BitcoinWaitForTransactionTask.name
      : WaitForTransactionStatusTask.name
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<BitcoinStepExecutorContext> => {
    const { client, fromChain, isBridgeExecution, step } = baseContext

    const publicClient = await getBitcoinPublicClient(client, fromChain.id)

    const pipeline = new TaskPipeline([
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new BitcoinSignAndExecuteTask(),
      new BitcoinWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ])

    const firstTaskName = this.getFirstTaskName(step, isBridgeExecution)

    return {
      ...baseContext,
      pipeline,
      firstTaskName,
      pollingIntervalMs: 10_000,
      checkClient: this.checkClient,
      walletClient: this.client,
      publicClient,
      parseErrors: parseBitcoinErrors,
      outputs: {},
    }
  }
}
