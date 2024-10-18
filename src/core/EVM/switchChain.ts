import type { Client } from 'viem'
import { getChainId } from 'viem/actions'
import { LiFiErrorCode } from '../../errors/constants.js'
import { ProviderError } from '../../errors/errors.js'
import type { StatusManager } from '../StatusManager.js'
import type { LiFiStepExtended, SwitchChainHook } from '../types.js'

/**
 * This method checks whether the wallet client is configured for the correct chain.
 * If yes it returns the wallet clien.
 * If no and if user interaction is allowed it triggers the switchChainHook. If no user interaction is allowed it aborts.
 *
 * Account Type: local -
 * We need to create and return a new connector client from the switchChainHook in order to continue execution on a new chain.
 *
 * Account Type: json-rpc -
 * We can switch chain and return existing connector client from the switchChainHook in order to continue execution on a new chain.
 * @param client
 * @param statusManager
 * @param step
 * @param switchChainHook
 * @param allowUserInteraction
 * @returns New connector client
 */
export const switchChain = async (
  client: Client,
  statusManager: StatusManager,
  step: LiFiStepExtended,
  allowUserInteraction: boolean,
  switchChainHook?: SwitchChainHook
): Promise<Client | undefined> => {
  // if we are already on the correct chain we can proceed directly
  const currentChainId = await getChainId(client)
  if (currentChainId === step.action.fromChainId) {
    return client
  }

  // -> set status message
  step.execution = statusManager.initExecutionObject(step)
  statusManager.updateExecution(step, 'ACTION_REQUIRED')

  let switchProcess = statusManager.findOrCreateProcess({
    step,
    type: 'SWITCH_CHAIN',
    status: 'ACTION_REQUIRED',
  })

  if (!allowUserInteraction) {
    return
  }

  try {
    const updatedClient = await switchChainHook?.(step.action.fromChainId)
    let updatedChainId: number | undefined
    if (updatedClient) {
      updatedChainId = await getChainId(updatedClient)
    }
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
    return updatedClient
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
