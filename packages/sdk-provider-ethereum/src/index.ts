// Generic, spender-agnostic Permit2 EIP-712 builders, namespaced to mirror
// @uniswap/permit2-sdk. Lets integrators sign Permit2 messages for any spender
// (their own contract, Uniswap's routers, ...) without routing through LI.FI's
// Permit2 proxy. Exposed as namespace objects to avoid the duplicate
// getPermitData/hash names across the two modes.
import * as AllowanceTransfer from './permits/allowanceTransfer.js'
import * as SignatureTransfer from './permits/signatureTransfer.js'

// biome-ignore lint/performance/noBarrelFile: module entrypoint
export { checkPermitSupport } from './actions/checkPermitSupport.js'
export {
  getTokenAllowance,
  getTokenAllowanceMulticall,
} from './actions/getAllowance.js'
export { isBatchingSupported } from './actions/isBatchingSupported.js'
export {
  revokeTokenApproval,
  setAllowance,
  setTokenAllowance,
} from './actions/setAllowance.js'
export { EthereumProvider } from './EthereumProvider.js'
export {
  isHyperliquidAgentStep,
  isHyperliquidOrderMessage,
} from './hyperliquid/isHyperliquidAgentStep.js'
export { PatcherMagicNumber } from './permits/constants.js'
export { permit2Domain } from './permits/domain.js'
export { getNativePermit } from './permits/getNativePermit.js'
export { isDelegationDesignatorCode } from './permits/isDelegationDesignatorCode.js'
export type {
  EthereumProviderOptions,
  EthereumSDKProvider,
  WalletCallReceipt,
} from './types.js'
export { isEthereumProvider } from './types.js'
export { convertExtendedChain } from './utils/convertExtendedChain.js'
export { isContractCallStep } from './utils/isContractCallStep.js'
export { isExtendedChain } from './utils/isExtendedChain.js'
export { isGaslessStep } from './utils/isGaslessStep.js'
export { isRelayerStep } from './utils/isRelayerStep.js'
export { isZeroAddress } from './utils/isZeroAddress.js'
export { AllowanceTransfer, SignatureTransfer }
