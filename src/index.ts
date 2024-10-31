// biome-ignore lint/performance/noBarrelFile: module entrypoint
// biome-ignore lint/performance/noReExportAll: types
export * from '@lifi/types'
export { config } from './config.js'
export { EVM } from './core/EVM/EVM.js'
export {
  getTokenAllowance,
  getTokenAllowanceMulticall,
} from './core/EVM/getAllowance.js'
export {
  revokeTokenApproval,
  setTokenAllowance,
} from './core/EVM/setAllowance.js'
export { isEVM } from './core/EVM/types.js'
export type {
  EVMProvider,
  EVMProviderOptions,
  MultisigConfig,
  MultisigTransaction,
  MultisigTxDetails,
} from './core/EVM/types.js'
export { StatusManager } from './core/StatusManager.js'
export {
  executeRoute,
  getActiveRoute,
  getActiveRoutes,
  resumeRoute,
  stopRouteExecution,
  updateRouteExecution,
} from './core/execution.js'
export type {
  AcceptExchangeRateUpdateHook,
  AcceptSlippageUpdateHook,
  AcceptSlippageUpdateHookParams,
  ExchangeRateUpdateParams,
  ExecutionOptions,
  InteractionSettings,
  LiFiStepExtended,
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
export { isSVMAddress } from './core/Solana/isSVMAddress.js'
export {
  KeypairWalletAdapter,
  KeypairWalletName,
} from './core/Solana/KeypairWalletAdapter.js'
export { Solana } from './core/Solana/Solana.js'
export { isSolana } from './core/Solana/types.js'
export type {
  SolanaProvider,
  SolanaProviderOptions,
} from './core/Solana/types.js'
export { UTXO } from './core/UTXO/UTXO.js'
export { isUTXO } from './core/UTXO/types.js'
export type { UTXOProvider, UTXOProviderOptions } from './core/UTXO/types.js'
export { createConfig } from './createConfig.js'
export {
  checkPackageUpdates,
  convertQuoteToRoute,
  fetchTxErrorDetails,
} from './helpers.js'
export {
  getChains,
  getConnections,
  getContractCallsQuote,
  getGasRecommendation,
  getQuote,
  getRoutes,
  getStatus,
  getStepTransaction,
  getToken,
  getTokens,
  getTools,
  getTransactionHistory,
} from './services/api.js'
export {
  getTokenBalance,
  getTokenBalances,
  getTokenBalancesByChain,
} from './services/balance.js'
export { getNameServiceAddress } from './services/getNameServiceAddress.js'
export type { RPCUrls, SDKBaseConfig, SDKConfig } from './types/internal.js'
export { BaseError } from './errors/baseError.js'
export {
  ErrorMessage,
  ErrorName,
  LiFiErrorCode,
} from './errors/constants.js'
export type { ErrorCode } from './errors/constants.js'
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
