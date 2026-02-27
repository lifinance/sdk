import { ExecuteStepRetryError } from '../errors/errors.js'
import type { SDKError } from '../errors/SDKError.js'
import type {
  ExecuteStepRetryParams,
  ExecutionAction,
  ExecutionOptions,
  InteractionSettings,
  LiFiStepExtended,
  SDKClient,
  StepExecutor,
  StepExecutorOptions,
} from '../types/core.js'
import type {
  StepExecutorBaseContext,
  StepExecutorContext,
} from '../types/execution.js'
import { StatusManager } from './StatusManager.js'
import type { TaskPipeline } from './TaskPipeline.js'

// Please be careful when changing the defaults as it may break the behavior (e.g., background execution)
const defaultInteractionSettings = {
  allowInteraction: true,
  allowUpdates: true,
  allowExecution: true,
}

export abstract class BaseStepExecutor implements StepExecutor {
  protected executionOptions?: ExecutionOptions
  protected statusManager: StatusManager

  public allowUserInteraction = true
  public allowExecution = true

  constructor(options: StepExecutorOptions) {
    this.statusManager = new StatusManager(options.routeId)
    this.executionOptions = options.executionOptions
  }

  setInteraction = (settings?: InteractionSettings): void => {
    const interactionSettings = {
      ...defaultInteractionSettings,
      ...settings,
    }
    this.allowUserInteraction = interactionSettings.allowInteraction
    this.statusManager.allowUpdates(interactionSettings.allowUpdates)
    this.allowExecution = interactionSettings.allowExecution
  }

  private createBaseContext = async (
    client: SDKClient,
    step: LiFiStepExtended,
    retryParams?: ExecuteStepRetryParams
  ): Promise<StepExecutorBaseContext> => {
    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id

    return {
      client,
      step,
      fromChain,
      toChain,
      isBridgeExecution,
      retryParams,
      statusManager: this.statusManager,
      executionOptions: this.executionOptions,
      allowUserInteraction: this.allowUserInteraction,
    }
  }

  abstract createContext(
    baseContext: StepExecutorBaseContext
  ): Promise<StepExecutorContext>

  abstract createPipeline(context: StepExecutorContext): TaskPipeline

  abstract parseErrors(
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction,
    retryParams?: ExecuteStepRetryParams
  ): Promise<SDKError | ExecuteStepRetryError>

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended,
    retryParams?: ExecuteStepRetryParams
  ): Promise<LiFiStepExtended> => {
    try {
      step.execution = this.statusManager.initializeExecution(step)

      const baseContext = await this.createBaseContext(
        client,
        step,
        retryParams
      )
      const context = await this.createContext(baseContext)
      const pipeline = this.createPipeline(context)

      await pipeline.run(context)

      return step
    } catch (error: any) {
      const action = step.execution?.lastActionType
        ? this.statusManager.findAction(step, step.execution.lastActionType)
        : undefined
      const parsed = await this.parseErrors(error, step, action, retryParams)
      if (!(parsed instanceof ExecuteStepRetryError)) {
        if (action) {
          this.statusManager.updateAction(step, action.type, 'FAILED', {
            error: {
              message: parsed.cause?.message,
              code: parsed.code,
            },
          })
        } else {
          this.statusManager.updateExecution(step, {
            status: 'FAILED',
            error: {
              message: parsed.cause?.message,
              code: parsed.code,
            },
          })
        }
      }
      throw parsed
    }
  }
}
