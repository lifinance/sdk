import type { LiFiStep } from '@lifi/types'
import { getChainById } from '../client/getChainById.js'
import type { SDKClient } from '../core/types.js'

export const getTransactionFailedMessage = async (
  client: SDKClient,
  step: LiFiStep,
  txLink?: string
): Promise<string> => {
  const chain = await getChainById(client, step.action.toChainId)

  const baseString = `It appears that your transaction may not have been successful.
  However, to confirm this, please check your ${chain.name} wallet for ${step.action.toToken.symbol}.`
  return txLink
    ? `${baseString}
    You can also check the&nbsp;<a href="${txLink}" target="_blank" rel="nofollow noreferrer">block explorer</a> for more information.`
    : baseString
}
