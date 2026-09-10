import type { SignedTypedData } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getDomainChainId } from '../../../utils/getDomainChainId.js'
import { isValidSignature } from '../../../utils/isValidSignature.js'
import { isCallerIntentLaneInFlight } from './hasCallerIntentInFlight.js'

/**
 * The signed native EIP-2612 permit this step should execute through, if any.
 *
 * Returns `undefined` when the step carries a caller-supplied Permit2 intent,
 * even if a native permit was also signed. `EthereumStandardSignAndExecuteTask`
 * reacts to a native permit by wrapping the calldata in `encodeNativePermitData`
 * and retargeting the transaction to `fromChain.permit2Proxy`. For a caller
 * intent the calldata returned by `/advanced/stepTransaction` already embeds the
 * signature and must be sent to its own target untouched, so the wrap would
 * destroy the transaction.
 */
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
