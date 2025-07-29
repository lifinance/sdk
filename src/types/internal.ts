import type { ChainId, ExtendedChain, RouteOptions } from '@lifi/types'
import type { SDKProvider } from '../core/types.js'

export interface SDKBaseConfig {
  apiKey?: string
  apiUrl: string
  integrator: string
  userId?: string
  providers: SDKProvider[]
  routeOptions?: RouteOptions
  rpcUrls: RPCUrls
  chains: ExtendedChain[]
  disableVersionCheck?: boolean
  widgetVersion?: string
  preloadChains: boolean
  debug: boolean
}

export interface SDKConfig extends Partial<Omit<SDKBaseConfig, 'integrator'>> {
  integrator: string
}

export type RPCUrls = Partial<Record<ChainId, string[]>>
