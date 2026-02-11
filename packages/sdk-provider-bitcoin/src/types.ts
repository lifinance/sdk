import type { Client } from '@bigmi/core'
import {
  ChainType,
  type SDKProvider,
  type StepExecutorContext,
} from '@lifi/sdk'
import type { PublicClient } from './client/publicClient.js'

export interface BitcoinProviderOptions {
  getWalletClient?: () => Promise<Client>
}

export interface BitcoinStepExecutorContext extends StepExecutorContext {
  walletClient: Client
  publicClient: PublicClient
}

export interface BitcoinSDKProvider extends SDKProvider {
  setOptions(options: BitcoinProviderOptions): void
}

export function isBitcoinProvider(
  provider: SDKProvider
): provider is BitcoinSDKProvider {
  return provider.type === ChainType.UTXO
}
