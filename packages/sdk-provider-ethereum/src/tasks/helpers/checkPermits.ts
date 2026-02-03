import type {
  ExecutionAction,
  LiFiStepExtended,
  SignedTypedData,
  StatusManager,
  TypedData,
} from '@lifi/sdk'
import type { Client, Hex } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'

export type CheckPermitsResult =
  | {
      status: 'ACTION_REQUIRED'
    }
  | {
      status: 'NATIVE_PERMIT'
      data: SignedTypedData[]
    }

export const checkPermits = async (
  step: LiFiStepExtended,
  statusManager: StatusManager,
  permitTypedData: TypedData[],
  allowUserInteraction: boolean,
  checkClient: (
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ) => Promise<Client | undefined>
): Promise<CheckPermitsResult | undefined> => {
  let permitAction = statusManager.findOrCreateAction({
    step,
    type: 'PERMIT',
    chainId: step.action.fromChainId,
  })

  const signedTypedData: SignedTypedData[] = permitAction.signedTypedData ?? []
  for (const typedData of permitTypedData) {
    // Check if we already have a valid permit for this chain and requirements
    const signedTypedDataForChain = signedTypedData.find((signedTypedData) =>
      isNativePermitValid(signedTypedData, typedData)
    )

    if (signedTypedDataForChain) {
      // Skip signing if we already have a valid permit
      continue
    }

    permitAction = statusManager.updateAction(
      step,
      permitAction.type,
      'ACTION_REQUIRED'
    )
    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    const typedDataChainId =
      getDomainChainId(typedData.domain) || step.action.fromChainId
    // Switch to the permit's chain if needed
    const permitClient = await checkClient(step, permitAction, typedDataChainId)
    if (!permitClient) {
      return { status: 'ACTION_REQUIRED' }
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
      signature: signature as Hex,
    }
    signedTypedData.push(signedPermit)
    permitAction = statusManager.updateAction(
      step,
      permitAction.type,
      'ACTION_REQUIRED',
      {
        signedTypedData,
      }
    )
  }

  statusManager.updateAction(step, permitAction.type, 'DONE', {
    signedTypedData,
  })
  // Check if there's a signed permit for the source transaction chain
  const matchingPermit = signedTypedData.find(
    (signedTypedData) =>
      getDomainChainId(signedTypedData.domain) === step.action.fromChainId
  )
  if (matchingPermit) {
    return {
      status: 'NATIVE_PERMIT',
      data: signedTypedData,
    }
  }

  return undefined
}
