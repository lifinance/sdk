import { Signer } from 'ethers'
import { initStatus } from '../status'

import {
  CrossStep,
  Execution,
  LifiStep,
  Step,
  SwapStep,
  UpdateStep,
  SwitchChainHook,
  EnforcedObjectProperties,
  ExecutionSettings,
} from '../types'
import { AnySwapExecutionManager } from './bridges/anyswap.execute'
import { CbridgeExecutionManager } from './bridges/cbridge.execute'
import { HopExecutionManager } from './bridges/hop.execute'
import { HorizonExecutionManager } from './bridges/horizon.execute'
import { NXTPExecutionManager } from './bridges/nxtp.execute'
import { oneinch } from './exchanges/oneinch'
import { paraswap } from './exchanges/paraswap'
import { SwapExecutionManager } from './exchanges/swap.execute'
import { uniswap } from './exchanges/uniswaps'

export class StepExecutor {
  private swapExecutionManager = new SwapExecutionManager()
  private nxtpExecutionManager = new NXTPExecutionManager()
  private hopExecutionManager = new HopExecutionManager()
  private horizonExecutionManager = new HorizonExecutionManager()
  private cbridgeExecutionManager = new CbridgeExecutionManager()
  private anySwapExecutionManager = new AnySwapExecutionManager()

  executionStopped = false

  stopStepExecution = (): void => {
    this.swapExecutionManager.setShouldContinue(false)
    this.nxtpExecutionManager.setShouldContinue(false)
    this.hopExecutionManager.setShouldContinue(false)
    this.horizonExecutionManager.setShouldContinue(false)
    this.cbridgeExecutionManager.setShouldContinue(false)
    this.anySwapExecutionManager.setShouldContinue(false)

    this.executionStopped = true
  }

  executeStep = async (
    signer: Signer,
    step: Step,
    settings: EnforcedObjectProperties<ExecutionSettings>
  ): Promise<Step> => {
    // check if signer is for correct chain
    if ((await signer.getChainId()) !== step.action.fromChainId) {
      // change status to CHAIN_SWITCH_REQUIRED and return step without execution
      const { status, updateStepWithStatus } = initStatus(step, settings)
      status.status = 'CHAIN_SWITCH_REQUIRED'
      updateStepWithStatus(status)

      const updatedSigner = await settings.switchChainHook(
        step.action.fromChainId
      )
      if (
        updatedSigner &&
        (await updatedSigner.getChainId()) === step.action.fromChainId
      ) {
        signer = updatedSigner
      } else {
        throw Error('CHAIN SWITCH REQUIRED')
      }
    }

    switch (step.type) {
      case 'lifi':
      case 'cross':
        await this.executeCross(signer, step, settings)
        break
      case 'swap':
        await this.executeSwap(signer, step, settings)
        break
      default:
        throw new Error('Unsupported step type')
    }

    return step
  }

  private executeSwap = async (
    signer: Signer,
    step: SwapStep,
    settings: EnforcedObjectProperties<ExecutionSettings>
  ) => {
    const swapParams = {
      signer,
      step,
      settings,
    }

    switch (step.tool) {
      case 'paraswap':
        return await this.swapExecutionManager.execute({
          ...swapParams,
          parseReceipt: paraswap.parseReceipt,
        })
      case '1inch':
        return await this.swapExecutionManager.execute({
          ...swapParams,
          parseReceipt: oneinch.parseReceipt,
        })
      default:
        return await this.swapExecutionManager.execute({
          ...swapParams,
          parseReceipt: uniswap.parseReceipt,
        })
    }
  }

  private executeCross = async (
    signer: Signer,
    step: CrossStep | LifiStep,
    settings: EnforcedObjectProperties<ExecutionSettings>
  ) => {
    const crossParams = {
      signer,
      step,
      settings,
    }

    switch (step.tool) {
      case 'nxtp':
        return await this.nxtpExecutionManager.execute(crossParams)
      case 'hop':
        return await this.hopExecutionManager.execute(crossParams)
      case 'horizon':
        return await this.horizonExecutionManager.execute(crossParams)
      case 'cbridge':
        return await this.cbridgeExecutionManager.execute(crossParams)
      case 'anyswapV3':
      case 'anyswapV4':
      case 'anyswap':
        return await this.anySwapExecutionManager.execute(crossParams)
      default:
        throw new Error('Should never reach here, bridge not defined')
    }
  }
}
