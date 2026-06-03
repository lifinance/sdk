import { ChainType, type SDKClient } from '@lifi/sdk'
import { isEthereumProvider } from '../types.js'

export function getSafeApiKey(client: SDKClient): string | undefined {
  const provider = client.getProvider(ChainType.EVM)
  if (provider && isEthereumProvider(provider)) {
    return provider.options.safeApiKey
  }
  return undefined
}
