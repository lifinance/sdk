import type { SignedTypedData, TypedData } from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getOrCreateAgentWallet } from '../../../hyperliquid/agentWallet.js'
import {
  isApproveAgentMessage,
  isApproveBuilderFeeMessage,
  isHyperliquidOrderMessage,
} from '../../../hyperliquid/isHyperliquidAgentStep.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getDomainChainId } from '../../../utils/getDomainChainId.js'

export const signHyperliquidTypedData = async (
  context: EthereumStepExecutorContext,
  intentTypedData: TypedData[]
): Promise<SignedTypedData[] | undefined> => {
  const {
    step,
    fromChain,
    client,
    allowUserInteraction,
    checkClient,
    ethereumClient,
    getStorage,
  } = context

  if (!allowUserInteraction) {
    return
  }

  const signedResults: SignedTypedData[] = []
  const ownerAddress = ethereumClient.account!.address
  const storage = getStorage(client)

  const approveMessage = intentTypedData.find(isApproveAgentMessage)
  const existingAgentAddress = approveMessage?.message.agentAddress as
    | string
    | undefined

  const {
    account: agentAccount,
    needsApproval,
    expiresAt,
  } = await getOrCreateAgentWallet(storage, ownerAddress, existingAgentAddress)

  for (const typedData of intentTypedData) {
    if (isApproveAgentMessage(typedData)) {
      if (!needsApproval) {
        continue
      }

      const message = {
        ...typedData.message,
        agentAddress: agentAccount.address.toLowerCase(),
        agentName: `${typedData.message.agentName} valid_until ${expiresAt}`,
      }
      const typedDataChainId =
        getDomainChainId(typedData.domain) || fromChain.id

      const updatedClient = await checkClient(step, typedDataChainId)
      if (!updatedClient) {
        return
      }

      const signature = await getAction(
        updatedClient,
        signTypedData,
        'signTypedData'
      )({
        account: updatedClient.account!,
        primaryType: typedData.primaryType,
        domain: typedData.domain,
        types: typedData.types,
        message,
      })
      signedResults.push({ ...typedData, message, signature })
    } else if (isApproveBuilderFeeMessage(typedData)) {
      const typedDataChainId =
        getDomainChainId(typedData.domain) || fromChain.id

      const updatedClient = await checkClient(step, typedDataChainId)
      if (!updatedClient) {
        return
      }

      const signature = await getAction(
        updatedClient,
        signTypedData,
        'signTypedData'
      )({
        account: updatedClient.account!,
        primaryType: typedData.primaryType,
        domain: typedData.domain,
        types: typedData.types,
        message: typedData.message,
      })
      signedResults.push({ ...typedData, signature })
    } else if (isHyperliquidOrderMessage(typedData)) {
      const signature = await agentAccount.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
      signedResults.push({ ...typedData, signature })
    }
  }

  return signedResults
}
