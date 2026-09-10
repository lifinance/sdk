import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'

/**
 * Which execution lane one `step.typedData` entry belongs to.
 *
 * - `native-permit` — an EIP-2612 permit. Signed before the transaction is
 *   prepared, and it stands in for the ERC-20 allowance.
 * - `caller-intent` — a Permit2 message the caller supplied for its own
 *   spender. Signed before the transaction is prepared and threaded into
 *   `/advanced/stepTransaction`. It does NOT stand in for the allowance.
 * - `relayer-intent` — anything signed after prepare and posted to a relayer.
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
  chain?: ExtendedChain
): TypedDataLane {
  // Tested first, always. The SDK must never sign a gasless intent inline,
  // whatever else the entry looks like.
  //
  // The spender clause mirrors `isGaslessStep` verbatim. It looks unreachable —
  // `getPermitTransferFromValues` sets `spender` to `chain.permit2Proxy`, not
  // `chain.permit2` — but proving it dead needs the relayer service, and a wrong
  // answer breaks gasless. It stays until that is settled.
  if (
    typedData.primaryType === 'PermitWitnessTransferFrom' ||
    (!!chain?.permit2 && typedData.message.spender === chain.permit2)
  ) {
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
  chain?: ExtendedChain
): boolean {
  return !!step.typedData?.some(
    (typedData) => getTypedDataLane(typedData, chain) === 'caller-intent'
  )
}

/** Whether the step still carries typed data a relayer must sign and submit. */
export function hasRelayerIntent(
  step: LiFiStepExtended | LiFiStep,
  chain?: ExtendedChain
): boolean {
  return !!step.typedData?.some(
    (typedData) => getTypedDataLane(typedData, chain) === 'relayer-intent'
  )
}
