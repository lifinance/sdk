import type {
  ChainId,
  ChainType,
  CoinKey,
  ContractCall,
  ExtendedChain,
  FeeCost,
  GasCost,
  LiFiStep,
  Route,
  RouteOptions,
  Step,
  Substatus,
  Token,
  TokenAmount,
} from '@lifi/types'
import type { SDKStorage } from '../core/storage.js'
import type { ExtendedRequestInit } from './request.js'

export type RequestInterceptor = (
  request: ExtendedRequestInit
) => ExtendedRequestInit | Promise<ExtendedRequestInit>

export interface SDKBaseConfig {
  apiKey?: string
  apiUrl: string
  integrator: string
  userId?: string
  routeOptions?: RouteOptions
  executionOptions?: ExecutionOptions
  rpcUrls: RPCUrls
  disableVersionCheck?: boolean
  widgetVersion?: string
  debug: boolean
  preloadChains?: boolean
  chainsRefetchInterval?: number
  requestInterceptor?: RequestInterceptor
  storage?: SDKStorage
}

export interface SDKConfig
  extends Partial<Omit<SDKBaseConfig, 'integrator' | 'rpcUrls'>> {
  integrator: string
  /**
   * Per chain, one list for reads and sends, or lists by role. The client
   * keeps the read lists in `config.rpcUrls` and serves the write and bundle
   * lists through `getWriteRpcUrlsByChainId` and `getBundleRpcUrlsByChainId`.
   */
  rpcUrls?: RPCUrlsConfig
  providers?: SDKProvider[]
}

/**
 * RPC URLs for one chain, split by what they are used for.
 */
export interface RPCUrlsByRole {
  /**
   * Reads: balances, simulation and confirmation. Unset, the chain's own RPC
   * URLs serve reads, as for a chain with no `rpcUrls` entry.
   */
  read?: string[]
  /**
   * Sends. Unset or empty, the read URLs send as well. While `write` is set,
   * nothing is sent through the read URLs: when `bundle` is unset, the write
   * URLs that support bundles also submit bundles, and with none of them, a
   * route that needs a bundle fails.
   *
   * Only `@lifi/sdk-provider-solana` uses this today; other providers ignore
   * it.
   */
  write?: string[]
  /**
   * Bundle submissions (Jito `sendBundle`). Unset, empty, or with no URL that
   * supports bundles, the write URLs that do submit them. While `bundle` or
   * `write` is set, bundles never go to the read URLs.
   *
   * Only `@lifi/sdk-provider-solana` uses this today; other providers ignore
   * it.
   */
  bundle?: string[]
}

/**
 * The `rpcUrls` option of `createClient`: per chain, either one list for reads
 * and sends, or lists by role.
 */
export type RPCUrlsConfig = Partial<Record<ChainId, string[] | RPCUrlsByRole>>

/** RPC URL lists per chain. `client.config.rpcUrls` holds the read lists. */
export type RPCUrls = Partial<Record<ChainId, string[]>>

export interface SDKProvider {
  readonly type: ChainType
  /**
   * The chains this provider serves. Omit it to serve every chain of `type`
   * that no other provider lists.
   */
  readonly chainIds?: readonly ChainId[]
  /**
   * Validates a wallet address. With `chainId`, a provider whose chains use
   * different address formats accepts only that chain's format and refuses a
   * chain it does not know. Never forward `chainId` to a library function whose
   * second parameter means something else.
   */
  isAddress(address: string, chainId?: ChainId): boolean
  /**
   * Validates a token identifier, which several ecosystems shape unlike a
   * wallet address. A provider that omits the method has no token address
   * format, so never fall back to `isAddress`.
   */
  isTokenAddress?(address: string): boolean
  resolveAddress(
    name: string,
    client: SDKClient,
    chainId?: ChainId,
    token?: CoinKey
  ): Promise<string | undefined>
  getStepExecutor(options: StepExecutorOptions): Promise<StepExecutor>
  getBalance(
    client: SDKClient,
    walletAddress: string,
    tokens: Token[]
  ): Promise<TokenAmount[]>
}

export interface SDKClient {
  config: SDKBaseConfig
  providers: SDKProvider[]
  getProvider(type: ChainType, chainId?: ChainId): SDKProvider | undefined
  setProviders(providers: SDKProvider[]): void
  setChains(chains: ExtendedChain[]): void
  getChains(): Promise<ExtendedChain[]>
  getChainById(chainId: ChainId): Promise<ExtendedChain>
  getRpcUrls(): Promise<RPCUrls>
  getRpcUrlsByChainId(chainId: ChainId): Promise<string[]>
  /**
   * The chain's dedicated write RPC URLs (`rpcUrls[chainId].write`). Empty
   * when the chain has none.
   *
   * Optional so clients from other SDK versions, and hand-written ones, still
   * satisfy `SDKClient`. Providers treat a missing method as no write list.
   */
  getWriteRpcUrlsByChainId?(chainId: ChainId): Promise<string[]>
  /**
   * The chain's dedicated bundle RPC URLs (`rpcUrls[chainId].bundle`). Empty
   * when the chain has none. Optional for the same reason as
   * `getWriteRpcUrlsByChainId`.
   */
  getBundleRpcUrlsByChainId?(chainId: ChainId): Promise<string[]>
}

export interface StepExecutorOptions {
  routeId: string
  executionOptions?: ExecutionOptions
}

export interface InteractionSettings {
  allowInteraction?: boolean
  allowUpdates?: boolean
  allowExecution?: boolean
}

/**
 * Params passed when retrying executeStep after an ExecuteStepRetryError.
 * Providers can use this to pass strategy-specific retry options (e.g. atomicityNotReady for Ethereum 7702).
 */
export type ExecuteStepRetryParams = Record<string, unknown>

export interface StepExecutor {
  allowUserInteraction: boolean
  allowExecution: boolean
  setInteraction(settings?: InteractionSettings): void
  /**
   * @param signal Aborts when the execution stops. Only waits that start
   * after the broadcast may use it (`StepExecutorBaseContext.signal`).
   */
  executeStep(
    client: SDKClient,
    step: LiFiStepExtended,
    retryParams?: ExecuteStepRetryParams,
    signal?: AbortSignal
  ): Promise<LiFiStepExtended>
}

export interface RouteExecutionData {
  route: Route
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
}

export type RouteExecutionDataDictionary = Partial<
  Record<string, RouteExecutionData>
>

export interface RouteExtended extends Omit<Route, 'steps'> {
  steps: LiFiStepExtended[]
}

export interface LiFiStepExtended extends LiFiStep {
  execution?: Execution
}

export type StepExtended = Step & {
  execution?: Execution
}

export type TransactionParameters = {
  chainId?: number
  to?: string
  from?: string
  nonce?: number
  data?: string
  value?: bigint
  gas?: bigint
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

export type RouteExecutionDictionary = Partial<Record<string, Promise<Route>>>

/**
 * Called on every update of the route. It receives the SDK's working copy of
 * the route: the same object on every call of one execution, which the SDK
 * keeps changing after the hook returns. Copy or serialize it before you
 * store it.
 *
 * After `stopRouteExecution` it can still be called, but only to deliver the
 * transaction data (`txHash`, `txHex`, `taskId`, `txFinal`) of a task that
 * was still running at the stop, for example in an open wallet prompt. Store
 * that data, so a resume waits for that transaction instead of signing
 * again. If you deleted the route, ignore the call.
 */
export type UpdateRouteHook = (updatedRoute: RouteExtended) => void

export interface TransactionRequestParameters extends TransactionParameters {
  requestType: 'approve' | 'transaction'
}

export type TransactionRequestUpdateHook = (
  updatedTxRequest: TransactionRequestParameters
) => Promise<TransactionParameters>

export interface AcceptSlippageUpdateHookParams {
  toToken: Token
  oldToAmount: string
  newToAmount: string
  oldSlippage: number
  newSlippage: number
}

export type AcceptSlippageUpdateHook = (
  params: AcceptSlippageUpdateHookParams
) => Promise<boolean | undefined>

export interface ExchangeRateUpdateParams {
  toToken: Token
  oldToAmount: string
  newToAmount: string
}

export type AcceptExchangeRateUpdateHook = (
  params: ExchangeRateUpdateParams
) => Promise<boolean | undefined>

export interface ContractCallParams {
  fromChainId: number
  toChainId: number
  fromTokenAddress: string
  toTokenAddress: string
  fromAddress: string
  toAddress?: string
  fromAmount: bigint
  toAmount: bigint
  slippage?: number
}

export interface ContractTool {
  name: string
  logoURI: string
}

export interface GetContractCallsResult {
  contractCalls: ContractCall[]
  patcher?: boolean
  contractTool?: ContractTool
}

export type GetContractCallsHook = (
  params: ContractCallParams
) => Promise<GetContractCallsResult>

export interface ExecutionOptions {
  acceptExchangeRateUpdateHook?: AcceptExchangeRateUpdateHook
  /**
   * Receives the route on every update, and after `stopRouteExecution` the
   * late transaction data of a task that was still running. See
   * {@link UpdateRouteHook}.
   */
  updateRouteHook?: UpdateRouteHook
  updateTransactionRequestHook?: TransactionRequestUpdateHook
  getContractCalls?: GetContractCallsHook
  adjustZeroOutputFromPreviousStep?: boolean
  executeInBackground?: boolean
}

export type ExecutionStatus = 'ACTION_REQUIRED' | 'PENDING' | 'FAILED' | 'DONE'

export type ExecutionActionStatus =
  | 'STARTED'
  | 'ACTION_REQUIRED'
  | 'MESSAGE_REQUIRED'
  | 'RESET_REQUIRED'
  | 'PENDING'
  | 'FAILED'
  | 'DONE'
  | 'CANCELLED'

export type ExecutionActionType =
  | 'PERMIT'
  | 'CHECK_ALLOWANCE'
  | 'NATIVE_PERMIT'
  | 'RESET_ALLOWANCE'
  | 'SET_ALLOWANCE'
  | 'SWAP'
  | 'CROSS_CHAIN'
  | 'RECEIVING_CHAIN'

export type ExecutionAction = {
  type: ExecutionActionType
  status: ExecutionActionStatus
  message?: string
  substatus?: Substatus
  substatusMessage?: string
  chainId?: number
  txHash?: string
  txLink?: string
  taskId?: string
  txType?: TransactionMethodType
  /**
   * The number of calls of a batched (EIP-5792) transaction. Set with
   * `taskId` when `txType` is `batched`.
   */
  callCount?: number
  /**
   * Provider-specific serialized signed transaction (hex, XDR, base64 or JSON).
   * Present while the transaction may still need to be (re)sent or looked up.
   * Stellar keeps it, and Bitcoin keeps it unless every node refuses its first
   * send; Solana, Tron and Sui clear it when no longer needed.
   */
  txHex?: string
  /**
   * Set together with status `FAILED` when the outcome of this action's
   * transaction is known and final (failed or reverted on chain or at the
   * relayer, cancelled, replaced, or dropped with proof).
   * A FAILED action without this flag has an unknown outcome and is re-checked
   * on resume instead of being signed again.
   */
  txFinal?: boolean
  // Errors occured during the action execution (within tasks)
  error?: { code: string | number; message: string; htmlMessage?: string }
}

export interface Execution {
  startedAt: number
  signedAt?: number
  status: ExecutionStatus
  actions: Array<ExecutionAction>
  fromAmount?: string
  toAmount?: string
  toToken?: Token
  feeCosts?: FeeCost[]
  gasCosts?: GasCost[]
  internalTxLink?: string
  externalTxLink?: string
  // Errors occured outside of actions (e.g. during context creation)
  error?: { code: string | number; message: string; htmlMessage?: string }
}

export type TransactionMethodType = 'standard' | 'relayed' | 'batched'
