import type { ChainId, RouteOptions } from '@lifi/types'
import type { SDKProvider } from 'core/types.js'

export interface SDKConfig {
  integrator: string
  apiUrl: string
  apiKey?: string
  userId?: string
  disableVersionCheck?: boolean
  widgetVersion?: string
  routeOptions?: RouteOptions
  providers?: SDKProvider[]
  rpcUrls: Partial<Record<ChainId, string[]>>
}

export interface SDKOptions extends Partial<Omit<SDKConfig, 'integrator'>> {
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
