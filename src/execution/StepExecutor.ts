import { Signer } from 'ethers'
import {
  CrossStep,
  HaltingSettings,
  InternalExecutionSettings,
  LifiStep,
  Step,
  SwapStep,
} from '../types'
import { BridgeExecutionManager } from './bridges/bridge.execute'
import { SwapExecutionManager } from './exchanges/swap.execute'
import { StatusManager } from './StatusManager'
import { switchChain } from './switchChain'

const defaultHaltSettings = {
  allowUpdates: true,
  stopExecution: true,
}

export class StepExecutor {
  settings: InternalExecutionSettings
  statusManager: StatusManager
  private swapExecutionManager = new SwapExecutionManager()
  private bridgeExecutionManager = new BridgeExecutionManager()

  executionStopped = false

  constructor(
    statusManager: StatusManager,
    settings: InternalExecutionSettings
  ) {
    this.statusManager = statusManager
    this.settings = settings
  }

  stopStepExecution = (settings?: HaltingSettings): void => {
    const haltingSettings = {
      ...defaultHaltSettings,
      ...settings,
    }

    this.swapExecutionManager.allowInteraction(false)
    this.bridgeExecutionManager.allowInteraction(false)
    this.statusManager.allowUpdates(haltingSettings.allowUpdates)
    this.executionStopped = haltingSettings.stopExecution
  }

  executeStep = async (signer: Signer, step: Step): Promise<Step> => {
    // check if signer is for correct chain
    const updatedSigner = await switchChain(
      signer,
      this.statusManager,
      step,
      this.settings.switchChainHook,
      !this.executionStopped && !this.settings.executeInBackground
    )

    if (!updatedSigner) {
      // chain switch was not successful, stop execution here
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
