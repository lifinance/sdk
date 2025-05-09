import { ChainType } from '@lifi/types'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import type { SDKProvider, StepExecutorOptions } from '../types.js'

export interface SuiProviderOptions {
  getWallet?: () => Promise<WalletWithRequiredFeatures>
}

export interface SuiProvider extends SDKProvider {
  setOptions(options: SuiProviderOptions): void
}

export function isSui(provider: SDKProvider): provider is SuiProvider {
  return provider.type === ChainType.MVM
}

export interface SuiStepExecutorOptions extends StepExecutorOptions {
  wallet: WalletWithRequiredFeatures
}

export const SuiTokenShortAddress = '0x2::sui::SUI'
export const SuiTokenLongAddress =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
