import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'

/**
 * A Permit2 signature transfer the relayer submits: a witness, or a message
 * whose spender is canonical Permit2.
 */
function isSignatureTransferTypedData(
  typedData: TypedData,
  chain: ExtendedChain
): boolean {
  const spender = typedData.message?.spender
  return (
    typedData.primaryType === 'PermitWitnessTransferFrom' ||
    (!!chain.permit2 &&
      typeof spender === 'string' &&
      spender.toLowerCase() === chain.permit2.toLowerCase())
  )
}

/** Which execution lane one `step.typedData` entry belongs to. */
export type TypedDataLane =
  | 'native-permit'
  | 'permit2-allowance'
  | 'relayer-message'

// `chain` is required, and nothing else enforces it: `chain?` compiles and
// every test still passes, but a relayer message then classifies as
// `permit2-allowance` and gets signed inline. Do NOT relax it.
export function getTypedDataLane(
  typedData: TypedData,
  chain: ExtendedChain
): TypedDataLane {
  // A native `Permit` is classified BEFORE the gasless rule: LI.FI's relayer
  // signs a permit whose spender is `chain.permit2`, and calling that a relayer
  // message makes a gasless step ask the user to fund an approval.
  if (typedData.primaryType === 'Permit') {
    return 'native-permit'
  }
  if (isSignatureTransferTypedData(typedData, chain)) {
    return 'relayer-message'
  }
  if (typedData.primaryType === 'PermitSingle') {
    return 'permit2-allowance'
  }
  return 'relayer-message'
}

/** Whether the step carries a Permit2 allowance the SDK signs for a caller's own spender. */
export function hasPermit2Allowance(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return !!step.typedData?.some(
    (typedData) => getTypedDataLane(typedData, chain) === 'permit2-allowance'
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
export function hasRelayerMessage(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return !!step.typedData?.some(
    (typedData) => getTypedDataLane(typedData, chain) === 'relayer-message'
  )
}

/** Whether the step carries a Permit2 allowance and nothing a relayer must sign. */
export function isPermit2AllowanceLane(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return hasPermit2Allowance(step, chain) && !hasRelayerMessage(step, chain)
}
