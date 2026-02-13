import type { ExtendedChain, LiFiStepExtended } from '@lifi/sdk'
import type { EthereumExecutionStrategy } from '../../../types.js'

/* Check if chain has Permit2 contract deployed.
 * Permit2 should not be available for atomic batch.
 */
export const isPermit2Supported = (
  step: LiFiStepExtended,
  fromChain: ExtendedChain,
  isFromNativeToken: boolean,
  disableMessageSigning: boolean,
  strategy: EthereumExecutionStrategy
): boolean => {
  return (
    !!fromChain.permit2 &&
    !!fromChain.permit2Proxy &&
    !isFromNativeToken &&
    !disableMessageSigning &&
    strategy !== 'batch' &&
    // Approval address is not required for Permit2 per se, but we use it to skip allowance checks for direct transfers
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval &&
    !step.estimate.skipPermit
  )
}
