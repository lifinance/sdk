import type { LiFiStep } from '@lifi/types'
import { StatusManager } from './StatusManager.js'
import type {
  ExecutionOptions,
  InteractionSettings,
  StepExecutor,
  StepExecutorOptions,
} from './types.js'

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

  abstract executeStep(step: LiFiStep): Promise<LiFiStep>
}
