import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  LiFiErrorCode,
  ReceivingChainPipeline,
  type StepExecutorBaseContext,
  TransactionError,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { parseSolanaErrors } from '../errors/parseSolanaErrors.js'
import type {
  SolanaStepExecutorContext,
  SolanaStepExecutorOptions,
} from '../types.js'
import { SolanaSwapOrBridgePipeline } from './pipelines/SolanaSwapOrBridgePipeline.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SolanaStepExecutorContext> => {
    const { isBridgeExecution, step } = baseContext
    const actionPipelines = new ActionPipelineOrchestrator([
      new SolanaSwapOrBridgePipeline(isBridgeExecution),
      new ReceivingChainPipeline(),
    ])

    const walletAccount = this.wallet.accounts.find(
      (account) => account.address === step.action.fromAddress
    )
    if (!walletAccount) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    return {
      ...baseContext,
      actionPipelines,
      wallet: this.wallet,
      walletAccount,
      parseErrors: parseSolanaErrors,
      // Payload shared between tasks
      signedTransactions: [],
    }
  }
}
