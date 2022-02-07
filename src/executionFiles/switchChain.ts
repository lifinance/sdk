import { getChainById, SwitchChainHook } from '../types'
import { Signer } from 'ethers'
import StatusManager from '../StatusManager'
import { Step } from '@lifinance/types'

/**
 * This method checks whether the signer is configured for the correct chain.
 * If yes it returns the signer.
 * If no and if user interaction is allowed it triggers the switchChainHook. If no user interaction is allowed it aborts.
 *
 * @param signer
 * @param statusManager
 * @param step
 * @param switchChainHook
 * @param allowUserInteraction
 */
export const switchChain = async (
  signer: Signer,
  statusManager: StatusManager,
  step: Step,
  switchChainHook: SwitchChainHook,
  allowUserInteraction: boolean
): Promise<Signer | undefined> => {
  // if we are already on the correct chain we can proceed directly
  if ((await signer.getChainId()) === step.action.fromChainId) {
    return signer
  }

  // -> set status message
  step.execution = statusManager.initExecutionObject(step)
  statusManager.updateExecution(step, 'CHAIN_SWITCH_REQUIRED')
  const chain = getChainById(step.action.fromChainId)

  const switchProcess = statusManager.findOrCreateProcess(
    'switchProcess',
    step,
    `Change Chain to ${chain.name}`
  )

  if (!allowUserInteraction) return

  try {
    const updatedSigner = await switchChainHook(step.action.fromChainId)
    if (
      !updatedSigner ||
      (await updatedSigner.getChainId()) !== step.action.fromChainId
    ) {
      throw new Error('CHAIN SWITCH REQUIRED')
    }

    statusManager.removeProcess(step, switchProcess.id)
    statusManager.updateExecution(step, 'PENDING')
    return updatedSigner
  } catch (e: any) {
    statusManager.updateProcess(step, switchProcess.id, 'FAILED', {
      errorMessage: e.message,
      errorCode: e.code,
    })
    statusManager.updateExecution(step, 'FAILED')
    throw e
  }
}
