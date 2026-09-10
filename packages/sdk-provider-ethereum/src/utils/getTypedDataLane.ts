import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import { isGaslessTypedData } from './isGaslessStep.js'

/**
 * Which execution lane one `step.typedData` entry belongs to.
 *
 * - `native-permit` — an EIP-2612 permit. Signed before the transaction is
 *   prepared, and it stands in for the ERC-20 allowance.
 * - `caller-intent` — a Permit2 message the caller supplied for its own
 *   spender. Signed before prepare and threaded into
 *   `/advanced/stepTransaction`. It does NOT stand in for the allowance.
 * - `relayer-intent` — anything signed after prepare and posted to a relayer.
 */
export type TypedDataLane = 'native-permit' | 'caller-intent' | 'relayer-intent'

export function getTypedDataLane(
  typedData: TypedData,
  chain: ExtendedChain
): TypedDataLane {
  // Native permits are decided BEFORE the gasless rule. LI.FI's relayer signs
  // an EIP-2612 permit whose spender is `chain.permit2` (gasless
  // `src/signature/payload.ts`), and that permit must still reach
  // `EthereumCheckPermitsTask` — it stands in for the ERC-20 allowance, so
  // misclassifying it makes a gasless step ask the user to fund an approval.
  if (typedData.primaryType === 'Permit') {
    return 'native-permit'
  }
  // Every other entry a relayer owns is decided next: the SDK must never sign
  // a gasless intent inline. Shared with `isGaslessStep`, so the two cannot
  // drift.
  if (isGaslessTypedData(typedData, chain)) {
    return 'relayer-intent'
  }
  // `PermitSingle` only. If `@lifi/types` ever declares `PermitBatch`, it must
  // NOT join this rule: its `details` covers several tokens, while the
  // allowance path is single-token (`step.action.fromToken.address`).
  if (typedData.primaryType === 'PermitSingle') {
    return 'caller-intent'
  }
  // `Order`, `PermitBatch`, Hyperliquid messages and every future type.
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

/**
 * Whether the step runs on the caller-intent lane: it carries a Permit2 message the SDK signs for
 * the caller's own spender, and nothing a relayer must sign and submit. The user sends and funds
 * that transaction, and the calldata the API returns for it is final.
 *
 * The lanes are NOT mutually exclusive, and the second term is the whole point. A step carrying
 * both a witness intent and a caller intent is still gasless: the relayer pulls the tokens through
 * Permit2, so every gate that must leave a caller-executed step alone has to keep its hands off
 * that step too. Ask the question in one place.
 */
export function isCallerIntentLane(
  step: LiFiStepExtended | LiFiStep,
  chain: ExtendedChain
): boolean {
  return hasCallerIntent(step, chain) && !hasRelayerIntent(step, chain)
}
