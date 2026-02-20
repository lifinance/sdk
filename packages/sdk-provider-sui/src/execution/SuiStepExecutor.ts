import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  ReceivingChainPipeline,
  type StepExecutorBaseContext,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { parseSuiErrors } from '../errors/parseSuiErrors.js'
import type {
  SuiStepExecutorContext,
  SuiStepExecutorOptions,
} from '../types.js'
import { SuiSwapOrBridgePipeline } from './pipelines/SuiSwapOrBridgePipeline.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private wallet: WalletWithRequiredFeatures

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  override getContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<SuiStepExecutorContext> => {
    const { isBridgeExecution } = baseContext
    const actionPipelines = new ActionPipelineOrchestrator([
      new SuiSwapOrBridgePipeline(isBridgeExecution),
      new ReceivingChainPipeline(),
    ])

    return {
      ...baseContext,
      actionPipelines,
      wallet: this.wallet,
      parseErrors: parseSuiErrors,
      // Payload shared between tasks
      signedTransaction: undefined,
    }
  }
}
