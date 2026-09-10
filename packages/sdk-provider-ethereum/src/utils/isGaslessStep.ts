import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import type { RelayerStep } from '../types.js'

/**
 * Whether one typed-data entry is one a relayer must sign and submit for a
 * gasless step. The single home of that test — `getTypedDataLane` asks it
 * before deciding any caller-owned lane, so no entry a relayer owns can escape
 * into the inline-signing path. Only the native EIP-2612 permit is decided
 * ahead of it, and a relayer step needs that signed inline anyway.
 *
 * The spender comparison is case-sensitive by inheritance; normalising it is
 * out of scope, and the point of the extraction is that it now has ONE home.
 * `message?.spender` is optional on purpose: this predicate decides whether
 * the SDK signs something inline, so a malformed entry answers `false`
 * instead of throwing.
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
