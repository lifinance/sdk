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
}

export interface SDKConfig extends Partial<Omit<SDKBaseConfig, 'integrator'>> {
  integrator: string
}

export type RPCUrls = Partial<Record<ChainId, string[]>>

export interface SDKProvider {
  readonly type: ChainType
  isAddress(address: string): boolean
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
  getProvider(type: ChainType): SDKProvider | undefined
  setProviders(providers: SDKProvider[]): void
  setChains(chains: ExtendedChain[]): void
  getChains(): Promise<ExtendedChain[]>
  getChainById(chainId: ChainId): Promise<ExtendedChain>
  getRpcUrls(): Promise<RPCUrls>
  getRpcUrlsByChainId(chainId: ChainId): Promise<string[]>
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

export interface StepExecutor {
  allowUserInteraction: boolean
  allowExecution: boolean
  setInteraction(settings?: InteractionSettings): void
  executeStep(
    client: SDKClient,
    step: LiFiStepExtended
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
  updateRouteHook?: UpdateRouteHook
  updateTransactionRequestHook?: TransactionRequestUpdateHook
  getContractCalls?: GetContractCallsHook
  adjustZeroOutputFromPreviousStep?: boolean
  executeInBackground?: boolean
  disableMessageSigning?: boolean
  /**
   * @deprecated
   */
  infiniteApproval?: boolean
}


export type ExecutionStatus =
  | 'STARTED'
  | 'ACTION_REQUIRED'
  | 'MESSAGE_REQUIRED'
  | 'RESET_REQUIRED'
  | 'PENDING'
  | 'FAILED'
  | 'DONE'

export type TransactionType =
  | 'TOKEN_ALLOWANCE'
  | 'PERMIT'
  | 'SWAP'
  | 'CROSS_CHAIN'
  | 'RECEIVING_CHAIN'

export type Transaction = {
  type: TransactionType
  chainId?: number
  txHash?: string
  taskId?: string
  txLink?: string
  txType?: TransactionMethodType
  txHex?: string
}

export interface Execution {
  type: TransactionType
  startedAt: number
  pendingAt?: number   
  actionRequiredAt?: number
  doneAt?: number
  status: ExecutionStatus
  substatus?: Substatus
  message?: string
  error?: {
    code: string | number
    message: string
    htmlMessage?: string
  }
  transactions: Array<Transaction>
  fromAmount?: string
  toAmount?: string
  toToken?: Token
  feeCosts?: FeeCost[]
  gasCosts?: GasCost[]
  internalTxLink?: string
  externalTxLink?: string

  // additional information
  [key: string]: any
}

export type TransactionMethodType = 'standard' | 'relayed' | 'batched'

export type ExecutionUpdate = Partial<Execution> & { transaction?: Transaction }
