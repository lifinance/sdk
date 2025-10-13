import type { ChainId, ChainType } from '@lifi/types'
import type { SDKBaseConfig, SDKProvider } from './types.js'

export const getProvider = (
  config: SDKBaseConfig,
  type: ChainType
): SDKProvider | undefined => {
  return config.providers.find(
    (provider: SDKProvider) => provider.type === type
  )
}

export async function getChainById(config: SDKBaseConfig, chainId: ChainId) {
  const chain = config.chains?.find((chain) => chain.id === chainId)
  if (!chain) {
    throw new Error(`ChainId ${chainId} not found`)
  }
  return chain
}
