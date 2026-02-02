import {
  BaseStepExecutor,
  type LiFiStepExtended,
  type PipelineSavedState,
  type SDKClient,
  TaskPipeline,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { parseSolanaErrors } from './errors/parseSolanaErrors.js'
import { createSolanaTaskPipeline } from './tasks/createSolanaTaskPipeline.js'
import { getSolanaPipelineContext } from './tasks/getSolanaPipelineContext.js'
import type { SolanaStepExecutorOptions } from './types.js'

export class SolanaStepExecutor extends BaseStepExecutor {
  private wallet: Wallet

  constructor(options: SolanaStepExecutorOptions) {
    super(options)
    this.wallet = options.wallet
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const baseContext = await getSolanaPipelineContext(client, step, {
      wallet: this.wallet,
      statusManager: this.statusManager,
      executionOptions: this.executionOptions,
      allowUserInteraction: this.allowUserInteraction,
    })

    const pipeline = new TaskPipeline(createSolanaTaskPipeline())

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
      const error = await parseSolanaErrors(e, step, baseContext.action)
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
