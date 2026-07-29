import type { LiFiStep } from '@lifi/sdk'
import { StrKey } from '@stellar/stellar-sdk'

/**
 * Resolves the SAC `approve` spender for a step, or `undefined` when the step
 * needs no approval.
 *
 * Precedence: an explicit provider override wins, otherwise
 * `step.estimate.approvalAddress` is used — but only when it is a real Soroban
 * contract (`C`) address.
 *
 * The `C`-address check is load-bearing, not defensive. The backend always fills
 * `approvalAddress` for Stellar steps, but with a placeholder: soroswap emits the
 * chain's `G`-address fallback wallet and polymer/nearIntents emit
 * `getLifiContractAddressForChain(XLM)`, which has no XLM override and so returns
 * the EVM diamond (`0x1231DEB6…`). Approving either would be meaningless at best.
 * Validating the address shape means this returns `undefined` today and starts
 * returning the router automatically once the backend emits it — no SDK change.
 */
export const resolveApprovalSpender = (
  step: LiFiStep,
  override?: string
): string | undefined => {
  if (override) {
    return override
  }
  const approvalAddress = step.estimate.approvalAddress
  return approvalAddress && StrKey.isValidContract(approvalAddress)
    ? approvalAddress
    : undefined
}
