import type { Account, Chain, Client, Transport } from '@bigmi/core'

import { ChainType } from '@lifi/types'
import type { SDKProvider } from '../types.js'

export interface UTXOProviderOptions {
  getWalletClient?: () => Promise<Client<Transport, Chain, Account>>
}

export interface UTXOProvider extends SDKProvider {
  setOptions(options: UTXOProviderOptions): void
}

export function isUTXO(provider: SDKProvider): provider is UTXOProvider {
  return provider.type === ChainType.UTXO
}
