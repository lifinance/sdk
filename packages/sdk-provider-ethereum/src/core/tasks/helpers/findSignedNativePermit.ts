import type { SignedTypedData } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getDomainChainId } from '../../../utils/getDomainChainId.js'
import { isValidSignature } from '../../../utils/isValidSignature.js'
import { isCallerIntentLaneInFlight } from './hasCallerIntentInFlight.js'

/** The signed native EIP-2612 permit this step should execute through, if any. */
export function findSignedNativePermit(
  context: EthereumStepExecutorContext
): SignedTypedData | undefined {
  const { fromChain, signedTypedData } = context

  if (isCallerIntentLaneInFlight(context)) {
    return undefined
  }

  return signedTypedData.find(
    (typedData) =>
      typedData.primaryType === 'Permit' &&
      getDomainChainId(typedData.domain) === fromChain.id &&
      isValidSignature(typedData.signature)
  )
}
