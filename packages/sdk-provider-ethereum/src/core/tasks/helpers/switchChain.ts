import { LiFiErrorCode, ProviderError } from '@lifi/sdk'
import {
  type Client,
  type GetChainIdReturnType,
  UserRejectedRequestError,
} from 'viem'
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
 * @param client The client to switch the chain for
 * @param targetChainId The target chain id to switch to
 * @param allowUserInteraction Whether user interaction is allowed
 * @param switchChainCallback The callback to switch the chain
 * @returns New connector client
 */
export const switchChain = async (
  client: Client,
  targetChainId: number,
  allowUserInteraction: boolean,
  switchChainCallback?: (chainId: number) => Promise<Client | undefined>
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
  if (!switchChainCallback) {
    throw new ProviderError(
      LiFiErrorCode.ChainSwitchError,
      'Chain switch hook is not provided.'
    )
  }
  let updatedClient: Client | undefined
  try {
    updatedClient = await switchChainCallback(targetChainId)
  } catch (error) {
    // A user rejection keeps its own meaning (`SignatureRejected`).
    if (isUserRejection(error)) {
      throw error
    }
    // Any other failure (for example, the wallet does not know the chain)
    // is a chain switch error, not an unknown one.
    throw new ProviderError(
      LiFiErrorCode.ChainSwitchError,
      `The wallet could not switch to chain ${targetChainId}.`,
      error as Error
    )
  }
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
}

const isUserRejection = (error: unknown): boolean => {
  const e = error as { name?: string; code?: number } | undefined
  return (
    e?.name === 'UserRejectedRequestError' ||
    e?.code === UserRejectedRequestError.code
  )
}
