import {
  BaseStepExecutor,
  CheckBalanceTask,
  LiFiErrorCode,
  type LiFiStepExtended,
  PrepareTransactionTask,
  type StepExecutorBaseContext,
  TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { parseSolanaErrors } from '../errors/parseSolanaErrors.js'
import type {
  SolanaStepExecutorContext,
  SolanaStepExecutorOptions,
} from '../types.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  getFirstTaskName = (step: LiFiStepExtended, isBridgeExecution: boolean) => {
    const swapOrBridgeAction = this.statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!swapOrBridgeAction?.txHash) {
      return CheckBalanceTask.name
    }
    return WaitForTransactionStatusTask.name
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SolanaStepExecutorContext> => {
    const { step, isBridgeExecution } = baseContext

    const walletAccount = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )
    if (!walletAccount) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    const pipeline = new TaskPipeline([
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new SolanaSignAndExecuteTask(),
      new SolanaWaitForTransactionTask(),
      new WaitForTransactionStatusTask(
        isBridgeExecution ? 'RECEIVING_CHAIN' : 'SWAP'
      ),
    ])

    const firstTaskName = this.getFirstTaskName(step, isBridgeExecution)

    return {
      ...baseContext,
      pipeline,
      firstTaskName,
      wallet: this.wallet,
      walletAccount,
      parseErrors: parseSolanaErrors,
      outputs: {},
    }
  }
}
