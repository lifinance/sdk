import { Signer } from 'ethers'
import {
  CrossStep,
  InteractionSettings,
  InternalExecutionSettings,
  LifiStep,
  Step,
  SwapStep,
} from '../types'
import { BridgeExecutionManager } from './bridges/bridge.execute'
import { SwapExecutionManager } from './exchanges/swap.execute'
import { StatusManager } from './StatusManager'
import { switchChain } from './switchChain'

// Please be careful when changing the defaults as it may break the behavior (e.g., background execution)
const defaultInteractionSettings = {
  allowInteraction: true,
  allowUpdates: true,
  stopExecution: false,
}

export class StepExecutor {
  settings: InternalExecutionSettings
  statusManager: StatusManager
  private swapExecutionManager = new SwapExecutionManager()
  private bridgeExecutionManager = new BridgeExecutionManager()

  allowUserInteraction = true
  executionStopped = false

  constructor(
    statusManager: StatusManager,
    settings: InternalExecutionSettings
  ) {
    this.statusManager = statusManager
    this.settings = settings
  }

  setInteraction = (settings?: InteractionSettings): void => {
    const interactionSettings = {
      ...defaultInteractionSettings,
      ...settings,
    }
    this.allowUserInteraction = interactionSettings.allowInteraction
    this.swapExecutionManager.allowInteraction(
      interactionSettings.allowInteraction
    )
    this.bridgeExecutionManager.allowInteraction(
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

    switch (step.type) {
      case 'lifi':
      case 'cross':
        await this.executeCross(signer, step)
        break
      case 'swap':
        await this.executeSwap(signer, step)
        break
      default:
        throw new Error('Unsupported step type.')
    }

    return step
  }

  private executeSwap = (signer: Signer, step: SwapStep) => {
    const swapParams = {
      signer,
      step,
      settings: this.settings,
      statusManager: this.statusManager,
    }

    return this.swapExecutionManager.execute(swapParams)
  }

  private executeCross = (signer: Signer, step: CrossStep | LifiStep) => {
    const crossParams = {
      signer,
      step,
      settings: this.settings,
      statusManager: this.statusManager,
    }

    return this.bridgeExecutionManager.execute(crossParams)
  }
}
