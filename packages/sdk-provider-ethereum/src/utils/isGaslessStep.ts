import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import type { RelayerStep } from '../types.js'

/**
 * Whether one typed-data entry is one a relayer must sign and submit for a
 * gasless step.
 *
 * The single home of that test. `getTypedDataLane` asks it first, before any
 * other rule, so no entry a relayer owns can escape into the inline-signing
 * path.
 *
 * The spender comparison is case-sensitive by inheritance — this is the shape
 * `isGaslessStep` has always had — while `getApprovalAmount` lowercases both
 * sides of its own address comparison. Address normalisation is out of scope
 * per §10 of the design; the point of the extraction is that the comparison
 * now has ONE place to change when that is settled.
 */
export function isGaslessTypedData(
  typedData: TypedData,
  chain?: ExtendedChain
): boolean {
  return (
    typedData.primaryType === 'PermitWitnessTransferFrom' ||
    (!!chain?.permit2 && typedData.message.spender === chain.permit2)
  )
}

export function isGaslessStep(
  step: LiFiStepExtended | LiFiStep,
  chain?: ExtendedChain
): step is RelayerStep {
  return !!step.typedData?.some((typedData) =>
    isGaslessTypedData(typedData, chain)
  )
}
