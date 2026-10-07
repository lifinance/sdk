import type { Client } from '@bigmi/core'
import {
  ChainType,
  type LiFiStepExtended,
  type SDKProvider,
  type StepExecutorContext,
} from '@lifi/sdk'
import type { PublicClient } from './client/publicClient.js'

export interface BitcoinProviderOptions {
  getWalletClient?: () => Promise<Client>
}

export interface BitcoinTaskContext {
  /**
   * Set by the sign task after a send it counts as sent, so the wait task of
   * the same run does not resend. Absent on a resume and on "Try again".
   */
  bitcoinSent?: boolean
}

export interface BitcoinStepExecutorContext
  extends StepExecutorContext,
    BitcoinTaskContext {
  walletClient: Client
  publicClient: PublicClient
  checkClient: (step: LiFiStepExtended) => void
}

export interface BitcoinSDKProvider extends SDKProvider {
  setOptions(options: BitcoinProviderOptions): void
}

export function isBitcoinProvider(
  provider: SDKProvider
): provider is BitcoinSDKProvider {
  // Other UTXO providers, such as Zcash, share the type but take no options.
  return provider.type === ChainType.UTXO && 'setOptions' in provider
}
