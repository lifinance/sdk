import { Signer } from 'ethers'
import StatusManager from '../StatusManager'

import {
  BridgeTool,
  CrossStep,
  ExchangeTool,
  getChainById,
  Hooks,
  LifiStep,
  Step,
  SwapStep,
} from '../types'
import { MultichainExecutionManager } from './bridges/multichain.execute'
import { CbridgeExecutionManager } from './bridges/cbridge.execute'
import { HopExecutionManager } from './bridges/hop.execute'
import { HorizonExecutionManager } from './bridges/horizon.execute'
import { NXTPExecutionManager } from './bridges/nxtp.execute'
import { oneinch } from './exchanges/oneinch'
import { openocean } from './exchanges/openocean'
import { paraswap } from './exchanges/paraswap'
import { SwapExecutionManager } from './exchanges/swap.execute'
import { uniswap } from './exchanges/uniswaps'

export class StepExecutor {
  settings: Hooks
  statusManager: StatusManager
  private swapExecutionManager = new SwapExecutionManager()
  private nxtpExecutionManager = new NXTPExecutionManager()
  private hopExecutionManager = new HopExecutionManager()
  private horizonExecutionManager = new HorizonExecutionManager()
  private cbridgeExecutionManager = new CbridgeExecutionManager()
  private multichainExecutionManager = new MultichainExecutionManager()

  executionStopped = false

  constructor(statusManager: StatusManager, settings: Hooks) {
    this.statusManager = statusManager
    this.settings = settings
  }

  stopStepExecution = (): void => {
    this.swapExecutionManager.setShouldContinue(false)
    this.nxtpExecutionManager.setShouldContinue(false)
    this.hopExecutionManager.setShouldContinue(false)
    this.horizonExecutionManager.setShouldContinue(false)
    this.cbridgeExecutionManager.setShouldContinue(false)
    this.multichainExecutionManager.setShouldContinue(false)

    this.executionStopped = true
  }

  executeStep = async (signer: Signer, step: Step): Promise<Step> => {
    // check if signer is for correct chain
    if ((await signer.getChainId()) !== step.action.fromChainId) {
      // -> set status message
      step.execution = this.statusManager.initExecutionObject(step)
      this.statusManager.updateExecution(step, 'CHAIN_SWITCH_REQUIRED')
      const chain = getChainById(step.action.fromChainId)

      const switchProcess = this.statusManager.findOrCreateProcess(
        'switchProcess',
        step,
        `Change Chain to ${chain.name}`
      )

      if (this.executionStopped) return step

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
        this.statusManager.updateProcess(step, switchProcess.id, 'FAILED', {
          errorMessage: e.message,
          errorCode: e.code,
        })
        this.statusManager.updateExecution(step, 'FAILED')
        throw e
      }

      this.statusManager.removeProcess(step, switchProcess.id)
      this.statusManager.updateExecution(step, 'PENDING')
    }

    switch (step.type) {
      case 'lifi':
      case 'cross':
        await this.executeCross(signer, step, this.settings)
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
      case ExchangeTool.paraswap:
        return await this.swapExecutionManager.execute({
          ...swapParams,
          parseReceipt: paraswap.parseReceipt,
        })
      case ExchangeTool.oneinch:
        return await this.swapExecutionManager.execute({
          ...swapParams,
          parseReceipt: oneinch.parseReceipt,
        })
      case ExchangeTool.openocean:
        return await this.swapExecutionManager.execute({
          ...swapParams,
          parseReceipt: openocean.parseReceipt,
        })
      case ExchangeTool.zerox:
      case ExchangeTool.dodo:
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
    hooks: Hooks
  ) => {
    const crossParams = {
      signer,
      step,
      hooks,
      statusManager: this.statusManager,
    }

    switch (step.tool) {
      case BridgeTool.connext:
      case 'nxtp': // keep for some time while user still may have unfinished routes locally
        return await this.nxtpExecutionManager.execute(crossParams)
      case BridgeTool.hop:
        return await this.hopExecutionManager.execute(crossParams)
      case BridgeTool.horizon:
        return await this.horizonExecutionManager.execute(crossParams)
      case BridgeTool.cbridge:
        return await this.cbridgeExecutionManager.execute(crossParams)
      case BridgeTool.multichain:
      case 'anyswap': // keep for some time while user still may have unfinished routes locally
        return await this.multichainExecutionManager.execute(crossParams)
      default:
        throw new Error('Should never reach here, bridge not defined')
    }
  }
}
