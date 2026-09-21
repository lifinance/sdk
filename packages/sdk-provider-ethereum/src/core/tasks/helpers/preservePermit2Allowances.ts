import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import {
  getTypedDataInLane,
  getTypedDataLane,
  isPermit2AllowanceLane,
} from '../../../utils/getTypedDataLane.js'

/**
 * `??` keeps the Permit2 allowance only when the answer omits `typedData`. An
 * answer that carries entries of its own — native permits, or `[]` from a
 * third-party backend — would drop it, and `signedTypedData` resets per
 * `executeStep`, so a retry would let the Permit2 proxy hijack the calldata.
 */
export function preservePermit2Allowances(
  step: LiFiStepExtended | LiFiStep,
  updatedTypedData: TypedData[] | undefined,
  chain: ExtendedChain
): TypedData[] | undefined {
  if (!updatedTypedData) {
    return step.typedData
  }

  if (!isPermit2AllowanceLane(step, chain)) {
    return updatedTypedData
  }

  const answerDeclaresLane = updatedTypedData.some((typedData) => {
    const lane = getTypedDataLane(typedData, chain)
    return lane === 'permit2-allowance' || lane === 'relayer-message'
  })
  if (answerDeclaresLane) {
    return updatedTypedData
  }

  return [
    ...updatedTypedData,
    ...getTypedDataInLane(step, 'permit2-allowance', chain),
  ]
}
