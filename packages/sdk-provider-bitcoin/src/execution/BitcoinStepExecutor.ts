import type { Client } from '@bigmi/core'
import {
  ActionPipelineOrchestrator,
  BaseStepExecutor,
  LiFiErrorCode,
  type LiFiStepExtended,
  ReceivingChainPipeline,
  type StepExecutorBaseContext,
  type StepExecutorOptions,
  TransactionError,
} from '@lifi/sdk'
import { getBitcoinPublicClient } from '../client/publicClient.js'
import { parseBitcoinErrors } from '../errors/parseBitcoinErrors.js'
import type { BitcoinStepExecutorContext } from '../types.js'
import { BitcoinSwapOrBridgePipeline } from './pipelines/BitcoinSwapOrBridgePipeline.js'

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

    const actionPipelines = new ActionPipelineOrchestrator([
      new BitcoinSwapOrBridgePipeline(isBridgeExecution),
      new ReceivingChainPipeline(),
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
