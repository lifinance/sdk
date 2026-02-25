import {
  ChainType,
  type SDKProvider,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'

export interface SuiProviderOptions {
  getClient?: () => Promise<ClientWithCoreApi>
  getSigner?: () => Promise<Signer>
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
  client: ClientWithCoreApi
  signer: Signer
}

export const SuiTokenShortAddress = '0x2::sui::SUI'
export const SuiTokenLongAddress =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
