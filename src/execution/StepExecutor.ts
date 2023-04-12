import { Signer } from 'ethers'
import {
  InteractionSettings,
  InternalExecutionSettings,
  LifiStep,
} from '../types'
import { StatusManager } from './StatusManager'
import { StepExecutionManager } from './StepExecutionManager'
import { switchChain } from './switchChain'

// Please be careful when changing the defaults as it may break the behavior (e.g., background execution)
const defaultInteractionSettings = {
  allowInteraction: true,
  allowUpdates: true,
  stopExecution: false,
}

export class StepExecutor {
  stepExecutionManager: StepExecutionManager
  statusManager: StatusManager
  settings: InternalExecutionSettings

  allowUserInteraction = true
  executionStopped = false

  constructor(
    statusManager: StatusManager,
    settings: InternalExecutionSettings
  ) {
    this.stepExecutionManager = new StepExecutionManager()
    this.statusManager = statusManager
    this.settings = settings
  }

  setInteraction = (settings?: InteractionSettings): void => {
    const interactionSettings = {
      ...defaultInteractionSettings,
      ...settings,
    }
    this.allowUserInteraction = interactionSettings.allowInteraction
    this.stepExecutionManager.allowInteraction(
      interactionSettings.allowInteraction
    )
    this.statusManager.allowUpdates(interactionSettings.allowUpdates)
    this.executionStopped = interactionSettings.stopExecution
  }

  // TODO: add checkChain method and update signer inside executors
  // This can come in handy when we execute multiple routes simultaneously and
  // should be sure that we are on the right chain when waiting for transactions.
  checkChain = () => {
    throw new Error('checkChain is not implemented.')
  }

  executeStep = async (signer: Signer, step: LifiStep): Promise<LifiStep> => {
    // Make sure that the chain is still correct

    // Find if the step is waiting for a transaction on the receiving chain
    const recievingChainProcess = step.execution?.process.find(
      (process) => process.type === 'RECEIVING_CHAIN'
    )

    // If the step is waiting for a transaction on the receiving chain, we do not switch the chain
    // All changes are already done from the source chain
    // Return the step
    if (recievingChainProcess?.substatus === 'WAIT_DESTINATION_TRANSACTION') {
      return step
    }

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

    await this.stepExecutionManager.execute(parameters)

    return step
  }
}
