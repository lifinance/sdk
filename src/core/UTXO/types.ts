import type { Client } from '@bigmi/core'

import { ChainType } from '@lifi/types'
import type { SDKProvider } from '../types.js'

export interface UTXOProviderOptions {
  getWalletClient?: () => Promise<Client>
}

export interface UTXOProvider extends SDKProvider {
  setOptions(options: UTXOProviderOptions): void
}

export function isUTXO(provider: SDKProvider): provider is UTXOProvider {
  return provider.type === ChainType.UTXO
}
