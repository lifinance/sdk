import type { Client } from '@bigmi/core'
import type { SDKProvider } from '@lifi/sdk'
import { ChainType } from '@lifi/types'

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
