import type { LiFiStep, LiFiStepExtended } from '@lifi/sdk'

/**
 * Whether the step carries a caller-supplied permit that is NOT a native
 * EIP-2612 permit — e.g. a Permit2 `PermitSingle` for a non-LI.FI spender.
 *
 * Such a permit is signed by {@link EthereumCheckPermitsTask} and embedded into
 * the step's own transaction by `getStepTransaction`. The SDK must therefore
 * NOT run its own native-permit or Permit2 signature flow on top: those sign a
 * second message and rewrite the calldata to the LI.FI Permit2 proxy, which is
 * wrong when the caller already brought a permit for its own spender. It should
 * still do the ERC-20 approval to `approvalAddress` (a Permit2 `PermitSingle`
 * grants Permit2 -> spender, not token -> Permit2, so the approval is still
 * required — unlike a native permit, which is itself the token allowance).
 *
 * A native `primaryType: 'Permit'` is intentionally excluded: the SDK consumes
 * that via `encodeNativePermitData`, which is the LI.FI native-permit flow.
 */
export function hasNonNativePermit(step: LiFiStepExtended | LiFiStep): boolean {
  return !!step.typedData?.some(
    (typedData) => typedData.primaryType !== 'Permit'
  )
}
