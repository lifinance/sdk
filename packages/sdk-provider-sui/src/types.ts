import type { SDKProvider, StepExecutorOptions } from '@lifi/sdk'
import { ChainType } from '@lifi/types'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'

export interface SuiProviderOptions {
  getWallet?: () => Promise<WalletWithRequiredFeatures>
}

export interface SuiSDKProvider extends SDKProvider {
  setOptions(options: SuiProviderOptions): void
}

export function isSuiProvider(
  provider: SDKProvider
): provider is SuiSDKProvider {
  return provider.type === ChainType.MVM
}

export interface SuiStepExecutorOptions extends StepExecutorOptions {
  wallet: WalletWithRequiredFeatures
}

export const SuiTokenShortAddress = '0x2::sui::SUI'
export const SuiTokenLongAddress =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
