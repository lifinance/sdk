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
 * The single home of that test. `getTypedDataLane` asks it before deciding any
 * caller-owned lane, so no entry a relayer owns can escape into the
 * inline-signing path. The one rule ahead of it is the native EIP-2612 permit,
 * which a relayer step needs signed inline anyway.
 *
 * The spender comparison is case-sensitive by inheritance — this is the shape
 * `isGaslessStep` has always had — while `getApprovalAmount` lowercases both
 * sides of its own address comparison. Address normalisation is out of scope
 * per §10 of the design; the point of the extraction is that the comparison
 * now has ONE place to change when that is settled.
 *
 * `message?.spender` is deliberately optional. `message` is required in
 * `@lifi/types`, so only contract-violating input can be missing it — but the
 * predecessor of this function read `message` only on entries that reached the
 * second `some`, and this one reads it on every entry that is not a witness
 * intent. This predicate decides whether the SDK signs something inline, so it
 * answers `false` for a malformed entry rather than throwing.
 */
export function isGaslessTypedData(
  typedData: TypedData,
  chain?: ExtendedChain
): boolean {
  return (
    typedData.primaryType === 'PermitWitnessTransferFrom' ||
    (!!chain?.permit2 && typedData.message?.spender === chain.permit2)
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
