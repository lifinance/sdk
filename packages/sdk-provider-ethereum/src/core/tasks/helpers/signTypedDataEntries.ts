import type {
  ExecutionActionStatus,
  ExecutionActionType,
  SignedTypedData,
  TypedData,
} from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getDomainChainId } from '../../../utils/getDomainChainId.js'
import { assertValidSignature } from '../../../utils/isValidSignature.js'

export type SignTypedDataEntriesResult =
  | { status: 'PAUSED' }
  | { status: 'COMPLETED'; signedTypedData: SignedTypedData[] }

/** Signs the entries in order, switching chains per entry, and appends the signatures. */
export async function signTypedDataEntries(
  context: EthereumStepExecutorContext,
  entries: TypedData[],
  actionType: ExecutionActionType,
  actionStatus: ExecutionActionStatus = 'ACTION_REQUIRED'
): Promise<SignTypedDataEntriesResult> {
  const {
    step,
    statusManager,
    allowUserInteraction,
    checkClient,
    signedTypedData: currentSignedTypedData,
  } = context

  const signedTypedData = [...currentSignedTypedData]

  for (const typedData of entries) {
    statusManager.updateAction(step, actionType, actionStatus)

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const typedDataChainId =
      getDomainChainId(typedData.domain) || step.action.fromChainId

    const client = await checkClient(step, typedDataChainId)
    if (!client) {
      return { status: 'PAUSED' }
    }

    const signature = await getAction(
      client,
      signTypedData,
      'signTypedData'
    )({
      account: client.account!,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    })
    assertValidSignature(signature)

    signedTypedData.push({ ...typedData, signature })
  }

  return { status: 'COMPLETED', signedTypedData }
}
