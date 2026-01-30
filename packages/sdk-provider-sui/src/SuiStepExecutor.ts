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
import { getSuiPipelineContext } from './tasks/helpers/getSuiPipelineContext.js'
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

    const baseContext = await getSuiPipelineContext(client, step, {
      wallet: this.wallet,
      statusManager: this.statusManager,
      executionOptions: this.executionOptions,
      allowUserInteraction: this.allowUserInteraction,
    })

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
          pipelineContext: result.pipelineContext,
        }
        return step
      }

      if (savedState) {
        delete step.execution.pipelineSavedState
      }
    } catch (e: any) {
      const error = await parseSuiErrors(e, step, baseContext.action)
      baseContext.action = this.statusManager.updateAction(
        step,
        baseContext.actionType,
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

    await waitForDestinationChainTransaction(
      client,
      step,
      baseContext.action,
      baseContext.fromChain,
      baseContext.toChain,
      this.statusManager
    )

    return step
  }
}
