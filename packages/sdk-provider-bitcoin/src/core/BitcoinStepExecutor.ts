import type { Client } from '@bigmi/core'
import {
  BaseStepExecutor,
  CheckBalanceTask,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  PrepareTransactionTask,
  type SDKError,
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

  override createPipeline = (context: BitcoinStepExecutorContext) => {
    const { step, isBridgeExecution } = context

    const tasks = [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new BitcoinSignAndExecuteTask(),
      new BitcoinWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ]
    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    const taskClassName = swapOrBridgeAction?.txHash
      ? swapOrBridgeAction?.status === 'DONE'
        ? WaitForTransactionStatusTask
        : BitcoinWaitForTransactionTask
      : CheckBalanceTask

    const firstTaskIndex = tasks.findIndex(
      (task) => task instanceof taskClassName
    )

    const tasksToRun = tasks.slice(firstTaskIndex)

    return new TaskPipeline(tasksToRun)
  }

  override parseErrors = (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ): Promise<SDKError> => parseBitcoinErrors(error, step, action)

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<BitcoinStepExecutorContext> => {
    const { client, fromChain } = baseContext

    const publicClient = await getBitcoinPublicClient(client, fromChain.id)

    return {
      ...baseContext,
      pollingIntervalMs: 10_000,
      checkClient: this.checkClient,
      walletClient: this.client,
      publicClient,
    }
  }
}
