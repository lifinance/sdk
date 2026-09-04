import type { LiFiStep, LiFiStepExtended } from '@lifi/sdk'

/**
 * Whether the step carries a caller-supplied permit that is not a native
 * EIP-2612 permit (e.g. a Permit2 `PermitSingle`). When it does, the SDK skips
 * its own native-permit and Permit2 signature flows.
 */
export function hasNonNativePermit(step: LiFiStepExtended | LiFiStep): boolean {
  return !!step.typedData?.some(
    (typedData) => typedData.primaryType !== 'Permit'
  )
}
