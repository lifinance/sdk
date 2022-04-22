import { Signer } from 'ethers'
import StatusManager from '../StatusManager'

import {
  CrossStep,
  HaltingSettings,
  InternalExecutionSettings,
  LifiStep,
  Step,
  SwapStep,
} from '../types'
import { SwapExecutionManager } from './exchanges/swap.execute'
import { switchChain } from './switchChain'
import { BridgeExecutionManager } from './bridges/bridge.execute'

const defaultExecutionHaltSettings = {
  allowUpdates: true,
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
      ...defaultExecutionHaltSettings,
      ...settings,
    }

    this.swapExecutionManager.setShouldContinue(false)
    this.bridgeExecutionManager.setShouldContinue(false)
    this.statusManager.setShouldUpdate(haltingSettings.allowUpdates)
    this.executionStopped = true
  }

  executeStep = async (signer: Signer, step: Step): Promise<Step> => {
    switch (step.type) {
      case 'lifi':
      case 'cross':
        await this.executeCross(signer, step)
        break
      case 'swap':
        await this.executeSwap(signer, step)
        break
      default:
        throw new Error('Unsupported step type')
    }

    return step
  }

  private executeSwap = async (signer: Signer, step: SwapStep) => {
    const swapParams = {
      signer,
      step,
      settings: this.settings,
      statusManager: this.statusManager,
    }

    return await this.swapExecutionManager.execute(swapParams)
  }

  private executeCross = async (signer: Signer, step: CrossStep | LifiStep) => {
    const crossParams = {
      signer,
      step,
      settings: this.settings,
      statusManager: this.statusManager,
    }

    return await this.bridgeExecutionManager.execute(crossParams)
  }
}
