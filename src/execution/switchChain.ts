import type { LifiStep } from '@lifi/types'
import type { WalletClient } from 'viem'
import type { SwitchChainHook } from '../types'
import { LiFiErrorCode, ProviderError } from '../utils/errors'
import type { StatusManager } from './StatusManager'

/**
 * This method checks whether the wallet client is configured for the correct chain.
 * If yes it returns the wallet clien.
 * If no and if user interaction is allowed it triggers the switchChainHook. If no user interaction is allowed it aborts.
 *
 * Account Type: local -
 * We need to create and return a new WalletClient from the switchChainHook in order to continue execution on a new chain.
 *
 * Account Type: json-rpc -
 * We can switch chain and return existing WalletClient from the switchChainHook in order to continue execution on a new chain.
 *
 * @param walletClient
 * @param statusManager
 * @param step
 * @param switchChainHook
 * @param allowUserInteraction
 */
export const switchChain = async (
  walletClient: WalletClient,
  statusManager: StatusManager,
  step: LifiStep,
  switchChainHook: SwitchChainHook,
  allowUserInteraction: boolean
): Promise<WalletClient | undefined> => {
  // if we are already on the correct chain we can proceed directly
  if ((await walletClient.getChainId()) === step.action.fromChainId) {
    return walletClient
  }

  // -> set status message
  step.execution = statusManager.initExecutionObject(step)
  statusManager.updateExecution(step, 'ACTION_REQUIRED')

  let switchProcess = statusManager.findOrCreateProcess(
    step,
    'SWITCH_CHAIN',
    'ACTION_REQUIRED'
  )

  if (!allowUserInteraction) {
    return
  }

  try {
    const updatedWalletClient = await switchChainHook(step.action.fromChainId)
    const updatedChainId = await updatedWalletClient?.getChainId()
    if (updatedChainId !== step.action.fromChainId) {
      throw new ProviderError(
        LiFiErrorCode.ChainSwitchError,
        'Chain switch required.'
      )
    }

    switchProcess = statusManager.updateProcess(
      step,
      switchProcess.type,
      'DONE'
    )
    statusManager.updateExecution(step, 'PENDING')
    return updatedWalletClient
  } catch (error: any) {
    statusManager.updateProcess(step, switchProcess.type, 'FAILED', {
      error: {
        message: error.message,
        code: LiFiErrorCode.ChainSwitchError,
      },
    })
    statusManager.updateExecution(step, 'FAILED')
    throw error
  }
}
