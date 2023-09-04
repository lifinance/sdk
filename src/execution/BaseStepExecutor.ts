import type { LiFiStep } from '@lifi/types'
import type { StatusManager } from './StatusManager'
import type {
  InteractionSettings,
  InternalExecutionSettings,
  StepExecutorOptions,
} from './types'

// Please be careful when changing the defaults as it may break the behavior (e.g., background execution)
const defaultInteractionSettings = {
  allowInteraction: true,
  allowUpdates: true,
  allowExecution: true,
}

export abstract class BaseStepExecutor {
  settings: InternalExecutionSettings
  statusManager: StatusManager

  allowUserInteraction = true
  allowExecution = true

  constructor(options: StepExecutorOptions) {
    this.statusManager = options.statusManager
    this.settings = options.settings
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
