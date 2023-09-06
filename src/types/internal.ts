import type { ChainId, RouteOptions } from '@lifi/types'
import type {
  ExecutionSettings,
  InternalExecutionSettings,
  MultisigConfig,
} from '../execution/types'
import type { SDKProvider } from '../providers'

export interface SDKConfig {
  apiUrl: string
  apiKey?: string
  rpcs: Record<ChainId, string[]>
  multicallAddresses: Record<ChainId, string | undefined>
  defaultExecutionSettings: InternalExecutionSettings
  defaultRouteOptions: RouteOptions
  disableVersionCheck?: boolean
  userId?: string
  integrator: string
  widgetVersion?: string
  multisig?: MultisigConfig
  providers?: SDKProvider[]
}

export interface SDKOptions
  extends Partial<Omit<SDKConfig, 'defaultExecutionSettings' | 'integrator'>> {
  defaultExecutionSettings?: ExecutionSettings
  integrator: string
}

export interface TenderlyResponse {
  hash: string
  block_hash: string
  block_number: number
  from: string
  gas: number
  gas_price: number
  gas_fee_cap: number
  gas_tip_cap: number
  cumulative_gas_used: number
  gas_used: number
  effective_gas_price: number
  input: string
  nonce: number
  to: string
  index: number
  value: string
  access_list: unknown
  status: boolean
  addresses: string[]
  contract_ids: string[]
  network_id: string
  timestamp: string
  function_selector: string
  l1_block_number: number
  l1_timestamp: number
  deposit_tx: boolean
  system_tx: boolean
  mint: number
  sig: {
    v: string
    r: string
    s: string
  }
  error_message: string
  method: string
  decoded_input: unknown
  call_trace: unknown
}
