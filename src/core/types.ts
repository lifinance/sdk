import type {
  ChainId,
  ChainType,
  CoinKey,
  ContractCall,
  FeeCost,
  GasCost,
  LiFiStep,
  Route,
  Step,
  Substatus,
  Token,
  TokenAmount,
} from '@lifi/types'
import type { Client } from 'viem'

export interface SDKProvider {
  readonly type: ChainType
  isAddress(address: string): boolean
  resolveAddress(
    name: string,
    chainId?: ChainId,
    token?: CoinKey
  ): Promise<string | undefined>
  getStepExecutor(options: StepExecutorOptions): Promise<StepExecutor>
  getBalance(walletAddress: string, tokens: Token[]): Promise<TokenAmount[]>
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
  executeStep(step: LiFiStepExtended): Promise<LiFiStepExtended>
}

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

export interface RouteExecutionData {
  route: Route
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
}

export type RouteExecutionDataDictionary = Partial<
  Record<string, RouteExecutionData>
>

export type RouteExecutionDictionary = Partial<Record<string, Promise<Route>>>

export type UpdateRouteHook = (updatedRoute: RouteExtended) => void

export interface TransactionRequestParameters extends TransactionParameters {
  requestType: 'approve' | 'transaction'
}

export type TransactionRequestUpdateHook = (
  updatedTxRequest: TransactionRequestParameters
) => Promise<TransactionParameters>

export type SwitchChainHook = (chainId: number) => Promise<Client | undefined>

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
  switchChainHook?: SwitchChainHook
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

export type ExecutionStatus = 'ACTION_REQUIRED' | 'PENDING' | 'FAILED' | 'DONE'

export type ProcessStatus =
  | 'STARTED'
  | 'ACTION_REQUIRED'
  | 'MESSAGE_REQUIRED'
  | 'RESET_REQUIRED'
  | 'PENDING'
  | 'FAILED'
  | 'DONE'
  | 'CANCELLED'

export type ProcessType =
  | 'TOKEN_ALLOWANCE'
  | 'PERMIT'
  | 'SWAP'
  | 'CROSS_CHAIN'
  | 'RECEIVING_CHAIN'

export type Process = {
  type: ProcessType
  status: ProcessStatus
  substatus?: Substatus
  chainId?: number
  txHash?: string
  taskId?: string
  txLink?: string
  txType?: TransactionMethodType
  actionRequiredAt?: number
  doneAt?: number
  failedAt?: number
  pendingAt?: number
  startedAt: number
  message?: string
  error?: {
    code: string | number
    message: string
    htmlMessage?: string
  }

  // additional information
  [key: string]: any
}

export interface Execution {
  startedAt: number
  doneAt?: number
  status: ExecutionStatus
  process: Array<Process>
  fromAmount?: string
  toAmount?: string
  toToken?: Token
  feeCosts?: FeeCost[]
  gasCosts?: GasCost[]
  internalTxLink?: string
  externalTxLink?: string
}

export type TransactionMethodType = 'standard' | 'relayed' | 'batched'
