import { Signer } from 'ethers'
import { StatusManager } from '..'
// import { initExecutionObject } from '../status'

import {
  CrossStep,
  LifiStep,
  Step,
  SwapStep,
  EnforcedObjectProperties,
  ExecutionSettings,
  Route,
  getChainById,
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
  route: Route
  settings: EnforcedObjectProperties<ExecutionSettings>
  statusManager: StatusManager
  private swapExecutionManager = new SwapExecutionManager()
  private nxtpExecutionManager = new NXTPExecutionManager()
  private hopExecutionManager = new HopExecutionManager()
  private horizonExecutionManager = new HorizonExecutionManager()
  private cbridgeExecutionManager = new CbridgeExecutionManager()
  private anySwapExecutionManager = new AnySwapExecutionManager()

  executionStopped = false

  constructor(
    route: Route,
    settings: EnforcedObjectProperties<ExecutionSettings>
  ) {
    this.route = route
    this.settings = settings
    this.statusManager = new StatusManager(route, settings)
  }

  stopStepExecution = (): void => {
    this.swapExecutionManager.setShouldContinue(false)
    this.nxtpExecutionManager.setShouldContinue(false)
    this.hopExecutionManager.setShouldContinue(false)
    this.horizonExecutionManager.setShouldContinue(false)
    this.cbridgeExecutionManager.setShouldContinue(false)
    this.anySwapExecutionManager.setShouldContinue(false)

    this.executionStopped = true
  }

  executeStep = async (signer: Signer, step: Step): Promise<Step> => {
    // check if signer is for correct chain
    if ((await signer.getChainId()) !== step.action.fromChainId) {
      // -> set status message
      const { currentExecution, updateExecution } =
        this.statusManager.initExecutionObject(step)
      currentExecution.status = 'CHAIN_SWITCH_REQUIRED'
      updateExecution(currentExecution)
      const chain = getChainById(step.action.fromChainId)
      const switchProcess = this.statusManager.createAndPushProcess(
        'switchProcess',
        updateExecution,
        currentExecution,
        `Change Chain to ${chain.name}`
      )
      let updatedSigner
      try {
        updatedSigner = await this.settings.switchChainHook(
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
      } catch (e: any) {
        if (e.message) switchProcess.errorMessage = e.message
        if (e.code) switchProcess.errorCode = e.code
        this.statusManager.setStatusFailed(
          updateExecution,
          currentExecution,
          switchProcess
        )
        throw e
      }

      this.statusManager.setStatusDone(
        updateExecution,
        currentExecution,
        switchProcess
      )
    }

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

  private executeCross = async (signer: Signer, step: CrossStep | LifiStep) => {
    const crossParams = {
      signer,
      step,
      settings: this.settings,
      statusManager: this.statusManager,
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
