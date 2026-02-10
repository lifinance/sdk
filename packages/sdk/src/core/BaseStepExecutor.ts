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
  TaskExtraBase,
} from '../types/tasks.js'
import { StatusManager } from './StatusManager.js'

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

  private getBaseContext = async (
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
      isTransactionExecuted: (action?: ExecutionAction) => {
        return (
          !!action &&
          !!(action.txHash || action.taskId) &&
          action.status !== 'DONE'
        )
      },
      retryParams,
      statusManager: this.statusManager,
      executionOptions: this.executionOptions,
      allowUserInteraction: this.allowUserInteraction,
    }
  }

  abstract getContext(
    baseContext: StepExecutorBaseContext
  ): Promise<StepExecutorContext<TaskExtraBase>>

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended,
    retryParams?: ExecuteStepRetryParams
  ): Promise<LiFiStepExtended> => {
    step.execution = this.statusManager.initExecutionObject(step)

    const baseContext = await this.getBaseContext(client, step, retryParams)
    const context = await this.getContext(baseContext)

    await context.pipeline.run(context)

    return step
  }
}
