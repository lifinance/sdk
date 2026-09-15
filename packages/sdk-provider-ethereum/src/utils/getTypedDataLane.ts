import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import { isGaslessTypedData } from './isGaslessStep.js'

/** Which execution lane one `step.typedData` entry belongs to. */
export type TypedDataLane = 'native-permit' | 'caller-intent' | 'relayer-intent'

// `chain` is required, and nothing else enforces it: `chain?` compiles and
// every test still passes, but a relayer intent then classifies as
// `caller-intent` and gets signed inline. Do NOT relax it.
export function getTypedDataLane(
  typedData: TypedData,
  chain: ExtendedChain
): TypedDataLane {
  // A native `Permit` is classified BEFORE the gasless rule: LI.FI's relayer
  // signs a permit whose spender is `chain.permit2`, and calling that a relayer
  // intent makes a gasless step ask the user to fund an approval.
  if (typedData.primaryType === 'Permit') {
    return 'native-permit'
  }
  if (isGaslessTypedData(typedData, chain)) {
    return 'relayer-intent'
  }
  if (typedData.primaryType === 'PermitSingle') {
    return 'caller-intent'
  }
  return 'relayer-intent'
}

/** Whether the step carries a Permit2 message the SDK signs for a caller's own spender. */
export function hasCallerIntent(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return !!step.typedData?.some(
    (typedData) => getTypedDataLane(typedData, chain) === 'caller-intent'
  )
}

/** The step's typed-data entries that belong to `lane`. */
export function getTypedDataInLane(
  step: LiFiStepExtended | LiFiStep,
  lane: TypedDataLane,
  chain: ExtendedChain
): TypedData[] {
  return (
    step.typedData?.filter(
      (typedData) => getTypedDataLane(typedData, chain) === lane
    ) ?? []
  )
}

/** Whether the step still carries typed data a relayer must sign and submit. */
export function hasRelayerIntent(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return !!step.typedData?.some(
    (typedData) => getTypedDataLane(typedData, chain) === 'relayer-intent'
  )
}

/** Whether the step carries a caller intent and nothing a relayer must sign. */
export function isCallerIntentLane(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return hasCallerIntent(step, chain) && !hasRelayerIntent(step, chain)
}
