// biome-ignore lint/performance/noBarrelFile: module entrypoint
// biome-ignore lint/performance/noReExportAll: types
export * from '@lifi/types'
export { config } from './config.js'
export { checkPermitSupport } from './core/EVM/checkPermitSupport.js'
export { EVM } from './core/EVM/EVM.js'
export {
  getTokenAllowance,
  getTokenAllowanceMulticall,
} from './core/EVM/getAllowance.js'
export { isBatchingSupported } from './core/EVM/isBatchingSupported.js'
export { getNativePermit } from './core/EVM/permits/getNativePermit.js'
export {
  revokeTokenApproval,
  setTokenAllowance,
} from './core/EVM/setAllowance.js'
export {
  isGaslessStep,
  isRelayerStep,
} from './core/EVM/typeguards.js'
export type {
  EVMProvider,
  EVMProviderOptions,
  WalletCallReceipt,
} from './core/EVM/types.js'
export { isEVM } from './core/EVM/types.js'
export {
  convertExtendedChain,
  isExtendedChain,
} from './core/EVM/utils.js'
export {
  executeRoute,
  getActiveRoute,
  getActiveRoutes,
  resumeRoute,
  stopRouteExecution,
  updateRouteExecution,
} from './core/execution.js'
export { isSVMAddress } from './core/Solana/isSVMAddress.js'
export {
  KeypairWalletAdapter,
  KeypairWalletName,
} from './core/Solana/KeypairWalletAdapter.js'
export { Solana } from './core/Solana/Solana.js'
export type {
  SolanaProvider,
  SolanaProviderOptions,
} from './core/Solana/types.js'
export { isSolana } from './core/Solana/types.js'
export { StatusManager } from './core/StatusManager.js'
export { Sui } from './core/Sui/Sui.js'
export type { SuiProvider, SuiProviderOptions } from './core/Sui/types.js'
export { isSui } from './core/Sui/types.js'
export type {
  AcceptExchangeRateUpdateHook,
  AcceptSlippageUpdateHook,
  AcceptSlippageUpdateHookParams,
  ExchangeRateUpdateParams,
  Execution,
  ExecutionOptions,
  ExecutionStatus,
  InteractionSettings,
  LiFiStepExtended,
  Process,
  ProcessStatus,
  ProcessType,
  RouteExecutionData,
  RouteExecutionDataDictionary,
  RouteExecutionDictionary,
  RouteExtended,
  SDKProvider,
  StepExecutor,
  StepExecutorOptions,
  StepExtended,
  SwitchChainHook,
  TransactionParameters,
  TransactionRequestParameters,
  TransactionRequestUpdateHook,
  UpdateRouteHook,
} from './core/types.js'
export type { UTXOProvider, UTXOProviderOptions } from './core/UTXO/types.js'
export { isUTXO } from './core/UTXO/types.js'
export { UTXO } from './core/UTXO/UTXO.js'
export { createConfig } from './createConfig.js'
export { BaseError } from './errors/baseError.js'
export type { ErrorCode } from './errors/constants.js'
export { ErrorMessage, ErrorName, LiFiErrorCode } from './errors/constants.js'
export {
  BalanceError,
  ProviderError,
  RPCError,
  ServerError,
  TransactionError,
  UnknownError,
  ValidationError,
} from './errors/errors.js'
export { HTTPError } from './errors/httpError.js'
export { SDKError } from './errors/SDKError.js'
export {
  getChains,
  getConnections,
  getContractCallsQuote,
  getGasRecommendation,
  getQuote,
  getRelayedTransactionStatus,
  getRelayerQuote,
  getRoutes,
  getStatus,
  getStepTransaction,
  getToken,
  getTokens,
  getTools,
  getTransactionHistory,
  relayTransaction,
} from './services/api.js'
export {
  getTokenBalance,
  getTokenBalances,
  getTokenBalancesByChain,
} from './services/balance.js'
export { getNameServiceAddress } from './services/getNameServiceAddress.js'
export type { RPCUrls, SDKBaseConfig, SDKConfig } from './types/internal.js'
export { checkPackageUpdates } from './utils/checkPackageUpdates.js'
export { convertQuoteToRoute } from './utils/convertQuoteToRoute.js'
export { fetchTxErrorDetails } from './utils/fetchTxErrorDetails.js'
