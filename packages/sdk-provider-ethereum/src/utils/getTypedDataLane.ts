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
 *   spender. Signed before the transaction is prepared and threaded into
 *   `/advanced/stepTransaction`. It does NOT stand in for the allowance.
 * - `relayer-intent` — anything signed after prepare and posted to a relayer.
 *
 * `chain` is REQUIRED throughout this module. Omitting it silently disables
 * the spender rule, so a relayer intent would classify as `caller-intent` —
 * toward inline signing, the direction that loses money. Every production call
 * site has a chain: `EthereumStepExecutorContext.fromChain` is non-optional.
 */
export type TypedDataLane = 'native-permit' | 'caller-intent' | 'relayer-intent'

/**
 * Primary types the SDK signs inline for a caller's own spender.
 *
 * Deliberately `readonly string[]`, not a `TypedDataPrimaryType` union.
 * `@lifi/types` does not declare `PermitSingle`, so `primaryType === 'PermitSingle'`
 * fails to compile with TS2367. The API can also ship a primary type before the
 * types package knows it, and this classifier tolerates that through its default
 * branch. `getTypedDataLane.unit.spec.ts` pins the literal, which recovers the
 * typo protection a union would have given.
 *
 * `PermitBatch` is excluded on purpose: its `details` covers several tokens,
 * while the allowance path is single-token (`step.action.fromToken.address`).
 */
const CALLER_INTENT_PRIMARY_TYPES: readonly string[] = ['PermitSingle']

export function getTypedDataLane(
  typedData: TypedData,
  chain: ExtendedChain
): TypedDataLane {
  // Tested first, always. The SDK must never sign a gasless intent inline,
  // whatever else the entry looks like.
  //
  // Shared with `isGaslessStep`, so the two can never drift. Its spender clause
  // looks unreachable — `getPermitTransferFromValues` sets `spender` to
  // `chain.permit2Proxy`, not `chain.permit2` — but proving it dead needs the
  // relayer service, and a wrong answer breaks gasless. It stays until that is
  // settled.
  if (isGaslessTypedData(typedData, chain)) {
    return 'relayer-intent'
  }
  if (typedData.primaryType === 'Permit') {
    return 'native-permit'
  }
  if (CALLER_INTENT_PRIMARY_TYPES.includes(typedData.primaryType)) {
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
