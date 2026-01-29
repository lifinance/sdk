import {
  BaseStepExecutor,
  type LiFiStepExtended,
  type PipelineSavedState,
  type SDKClient,
  TaskPipeline,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { parseSuiErrors } from './errors/parseSuiErrors.js'
import { createSuiTaskPipeline } from './tasks/createSuiTaskPipeline.js'
import type { SuiTaskExtra } from './tasks/types.js'
import type { SuiStepExecutorOptions } from './types.js'

export class SuiStepExecutor extends BaseStepExecutor {
  private wallet: WalletWithRequiredFeatures

  constructor(options: SuiStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    const action = this.statusManager.findOrCreateAction({
      step,
      type: currentActionType,
      chainId: fromChain.id,
    })

    const extra: SuiTaskExtra = {
      wallet: this.wallet,
      statusManager: this.statusManager,
      executionOptions: this.executionOptions,
      fromChain,
      toChain,
      isBridgeExecution,
      actionType: currentActionType,
      action,
    }

    const baseContext = {
      client,
      step,
      chain: fromChain,
      allowUserInteraction: this.allowUserInteraction,
      extra,
    }

    const pipeline = new TaskPipeline(createSuiTaskPipeline())

    try {
      const savedState = step.execution?.pipelineSavedState as
        | PipelineSavedState
        | undefined
      const result = savedState
        ? await pipeline.resume(savedState, baseContext)
        : await pipeline.run(baseContext)

      if (result.status === 'PAUSED') {
        step.execution.pipelineSavedState = {
          pausedAtTask: result.pausedAtTask,
          taskState: result.taskState,
          pipelineContext: result.pipelineContext,
        }
        return step
      }

      if (savedState) {
        delete step.execution.pipelineSavedState
      }
    } catch (e: any) {
      const error = await parseSuiErrors(e, step, extra.action)
      extra.action = this.statusManager.updateAction(
        step,
        extra.actionType,
        'FAILED',
        {
          error: {
            message: error.cause.message,
            code: error.code,
          },
        }
      )
      throw error
    }

    // TODO: Add this to the pipeline?
    await waitForDestinationChainTransaction(
      client,
      step,
      extra.action,
      fromChain,
      toChain,
      this.statusManager
    )

    return step
  }
}
