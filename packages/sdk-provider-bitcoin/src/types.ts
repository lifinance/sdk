import type { Client } from '@bigmi/core'
import { ChainType, type SDKProvider } from '@lifi/sdk'

export interface BitcoinProviderOptions {
  getWalletClient?: () => Promise<Client>
}

export interface BitcoinSDKProvider extends SDKProvider {
  setOptions(options: BitcoinProviderOptions): void
}

export function isBitcoinProvider(
  provider: SDKProvider
): provider is BitcoinSDKProvider {
  return provider.type === ChainType.UTXO
}
