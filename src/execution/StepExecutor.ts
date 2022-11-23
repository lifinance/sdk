import { Signer } from 'ethers'
import { InteractionSettings, InternalExecutionSettings, Step } from '../types'
import { ExecutionManager } from './ExecutionManager'
import { StatusManager } from './StatusManager'
import { switchChain } from './switchChain'

// Please be careful when changing the defaults as it may break the behavior (e.g., background execution)
const defaultInteractionSettings = {
  allowInteraction: true,
  allowUpdates: true,
  stopExecution: false,
}

export class StepExecutor {
  executionManager: ExecutionManager
  statusManager: StatusManager
  settings: InternalExecutionSettings

  allowUserInteraction = true
  executionStopped = false

  constructor(
    statusManager: StatusManager,
    settings: InternalExecutionSettings
  ) {
    this.executionManager = new ExecutionManager()
    this.statusManager = statusManager
    this.settings = settings
  }

  setInteraction = (settings?: InteractionSettings): void => {
    const interactionSettings = {
      ...defaultInteractionSettings,
      ...settings,
    }
    this.allowUserInteraction = interactionSettings.allowInteraction
    this.executionManager.allowInteraction(interactionSettings.allowInteraction)
    this.statusManager.allowUpdates(interactionSettings.allowUpdates)
    this.executionStopped = interactionSettings.stopExecution
  }

  // TODO: add checkChain method and update signer inside executors
  // This can come in handy when we execute multiple routes simultaneously and
  // should be sure that we are on the right chain when waiting for transactions.
  checkChain = () => {
    throw new Error('checkChain is not implemented.')
  }

  executeStep = async (signer: Signer, step: Step): Promise<Step> => {
    // Make sure that the chain is still correct
    const updatedSigner = await switchChain(
      signer,
      this.statusManager,
      step,
      this.settings.switchChainHook,
      this.allowUserInteraction
    )

    if (!updatedSigner) {
      // Chain switch was not successful, stop execution here
      return step
    }

    signer = updatedSigner

    const parameters = {
      signer,
      step,
      settings: this.settings,
      statusManager: this.statusManager,
    }

    await this.executionManager.execute(parameters)

    return step
  }
}
