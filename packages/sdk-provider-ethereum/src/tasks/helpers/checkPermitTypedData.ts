import type {
  ExecutionAction,
  LiFiStepExtended,
  SignedTypedData,
  StatusManager,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'

export const checkPermitTypedData = async (
  step: LiFiStepExtended,
  statusManager: StatusManager,
  allowUserInteraction: boolean,
  checkClient: (
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ) => Promise<Client | undefined>,
  disableMessageSigning: boolean,
  signedTypedData: SignedTypedData[]
) => {
  let action: ExecutionAction | undefined
  // First, try to sign all permits in step.typedData
  const permitTypedData = step.typedData?.filter(
    (typedData) => typedData.primaryType === 'Permit'
  )
  if (!disableMessageSigning && permitTypedData?.length) {
    action = statusManager.findOrCreateAction({
      step,
      type: 'PERMIT',
      chainId: step.action.fromChainId,
    })
    signedTypedData = action.signedTypedData ?? signedTypedData
    for (const typedData of permitTypedData) {
      // Check if we already have a valid permit for this chain and requirements
      const signedTypedDataForChain = signedTypedData.find((signedTypedData) =>
        isNativePermitValid(signedTypedData, typedData)
      )

      if (signedTypedDataForChain) {
        // Skip signing if we already have a valid permit
        continue
      }

      action = statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')
      if (!allowUserInteraction) {
        return null
      }

      const typedDataChainId =
        getDomainChainId(typedData.domain) || step.action.fromChainId
      // Switch to the permit's chain if needed
      const permitClient = await checkClient(step, action, typedDataChainId)
      if (!permitClient) {
        return null
      }

      const signature = await getAction(
        permitClient,
        signTypedData,
        'signTypedData'
      )({
        account: permitClient.account!,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
      const signedPermit: SignedTypedData = {
        ...typedData,
        signature,
      }
      signedTypedData.push(signedPermit)
      action = statusManager.updateAction(
        step,
        action.type,
        'ACTION_REQUIRED',
        {
          signedTypedData,
        }
      )
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      signedTypedData,
    })
    // Check if there's a signed permit for the source transaction chain
    const matchingPermit = signedTypedData.find(
      (signedTypedData) =>
        getDomainChainId(signedTypedData.domain) === step.action.fromChainId
    )
    if (matchingPermit) {
      return {
        hasMatchingPermit: true,
        signedTypedData,
      }
    }
  }

  return { hasMatchingPermit: false, signedTypedData }
}
