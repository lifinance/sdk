import type { Client } from '@bigmi/core'
import {
  BaseStepExecutor,
  type LiFiStepExtended,
  type PipelineSavedState,
  type SDKClient,
  type StepExecutorOptions,
  TaskPipeline,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import { parseBitcoinErrors } from './errors/parseBitcoinErrors.js'
import { createBitcoinTaskPipeline } from './tasks/createBitcoinTaskPipeline.js'
import { getBitcoinPipelineContext } from './tasks/helpers/getBitcoinPipelineContext.js'

interface BitcoinStepExecutorOptions extends StepExecutorOptions {
  client: Client
}

export class BitcoinStepExecutor extends BaseStepExecutor {
  private walletClient: Client

  constructor(options: BitcoinStepExecutorOptions) {
    super(options)
    this.walletClient = options.client
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const baseContext = await getBitcoinPipelineContext(client, step, {
      walletClient: this.walletClient,
      statusManager: this.statusManager,
      executionOptions: this.executionOptions,
      allowUserInteraction: this.allowUserInteraction,
    })

    const pipeline = new TaskPipeline(createBitcoinTaskPipeline())

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
      const error = await parseBitcoinErrors(e, step, baseContext.action)
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
      this.statusManager,
      10_000
    )

    return step
  }
}
