import type { ChainId, ExtendedChain, RouteOptions } from '@lifi/types'
import type { SDKProvider } from '../core/types.js'

export interface SDKBaseConfig {
  apiKey?: string
  apiUrl: string
  integrator: string
  userId?: string
  providers?: SDKProvider[]
  routeOptions?: RouteOptions
  rpcUrls: Partial<Record<ChainId, string[]>>
  chains: ExtendedChain[]
  disableVersionCheck?: boolean
  widgetVersion?: string
  preloadChains: boolean
}

export interface SDKConfig extends Partial<Omit<SDKBaseConfig, 'integrator'>> {
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
