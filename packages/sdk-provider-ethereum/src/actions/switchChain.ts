import {
  LiFiErrorCode,
  type LiFiStepExtended,
  ProviderError,
  type StatusManager,
} from '@lifi/sdk'
import type { Client, GetChainIdReturnType } from 'viem'
import { getChainId } from 'viem/actions'
import { getAction } from 'viem/utils'

/**
 * This method checks whether the wallet client is configured for the correct chain.
 * If yes it returns the wallet clien.
 * If no and if user interaction is allowed it triggers the switchChain callback. If no user interaction is allowed it aborts.
 *
 * Account Type: local -
 * We need to create and return a new connector client from the switchChain callback in order to continue execution on a new chain.
 *
 * Account Type: json-rpc -
 * We can switch chain and return existing connector client from the switchChain callback in order to continue execution on a new chain.
 * @param client
 * @param statusManager
 * @param step
 * @param switchChain
 * @param allowUserInteraction
 * @returns New connector client
 */
export const switchChain = async (
  client: Client,
  statusManager: StatusManager,
  step: LiFiStepExtended,
  targetChainId: number,
  allowUserInteraction: boolean,
  switchChain?: (chainId: number) => Promise<Client | undefined>
): Promise<Client | undefined> => {
  // if we are already on the correct chain we can proceed directly
  const currentChainId = (await getAction(
    client,
    getChainId,
    'getChainId'
  )(undefined)) as GetChainIdReturnType
  if (currentChainId === targetChainId) {
    return client
  }

  if (!allowUserInteraction) {
    return
  }

  try {
    if (!switchChain) {
      throw new ProviderError(
        LiFiErrorCode.ChainSwitchError,
        'Chain switch hook is not provided.'
      )
    }
    const updatedClient = await switchChain(targetChainId)
    let updatedChainId: number | undefined
    if (updatedClient) {
      updatedChainId = (await getAction(
        updatedClient,
        getChainId,
        'getChainId'
      )(undefined)) as GetChainIdReturnType
    }
    if (updatedChainId !== targetChainId) {
      throw new ProviderError(
        LiFiErrorCode.ChainSwitchError,
        'Chain switch required.'
      )
    }

    return updatedClient
  } catch (error: any) {
    statusManager.updateExecution(step, {
      status: 'FAILED',
      error: {
        message: error.message,
        code: LiFiErrorCode.ChainSwitchError,
      },
    })
    throw error
  }
}
