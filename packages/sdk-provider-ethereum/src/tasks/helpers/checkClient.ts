import {
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type StatusManager,
  TransactionError,
} from '@lifi/sdk'
import type { Client, GetAddressesReturnType } from 'viem'
import { getAddresses } from 'viem/actions'
import { getAction } from 'viem/utils'
import { parseEthereumErrors } from '../../errors/parseEthereumErrors.js'
import { switchChain } from './switchChain.js'

/**
 * Switch chain if needed, then verify wallet address matches step.fromAddress.
 * Returns updated client or undefined if user did not switch; throws on wallet mismatch.
 */
export async function checkClient(
  step: LiFiStepExtended,
  action: ExecutionAction,
  targetChainId: number | undefined,
  getClient: () => Client,
  setClient: (client: Client) => void,
  statusManager: StatusManager,
  allowUserInteraction: boolean,
  switchChainCallback?: (chainId: number) => Promise<Client | undefined>
): Promise<Client | undefined> {
  const currentClient = getClient()

  const updatedClient = await switchChain(
    currentClient,
    statusManager,
    step,
    action,
    targetChainId ?? step.action.fromChainId,
    allowUserInteraction,
    switchChainCallback
  )
  if (updatedClient) {
    setClient(updatedClient)
  }

  const client = getClient()
  let accountAddress = client.account?.address
  if (!accountAddress) {
    const accountAddresses = (await getAction(
      client,
      getAddresses,
      'getAddresses'
    )(undefined)) as GetAddressesReturnType
    accountAddress = accountAddresses?.[0]
  }
  if (
    accountAddress?.toLowerCase() !== step.action.fromAddress?.toLowerCase()
  ) {
    const errorMessage =
      'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
    statusManager.updateAction(step, action.type, 'FAILED', {
      error: {
        code: LiFiErrorCode.WalletChangedDuringExecution,
        message: errorMessage,
      },
    })
    throw await parseEthereumErrors(
      new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        errorMessage
      ),
      step,
      action
    )
  }
  return updatedClient
}
