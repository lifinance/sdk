import {
  ChainType,
  type LiFiStepExtended,
  type SDKProvider,
  type StepExecutorContext,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'

export interface SuiProviderOptions {
  getClient?: () => Promise<ClientWithCoreApi>
  getSigner?: () => Promise<Signer>
}

export interface SuiTaskContext {
  signedTransaction?: SuiClientTypes.Transaction
}

export interface SuiStepExecutorContext
  extends StepExecutorContext,
    SuiTaskContext {
  suiClient: ClientWithCoreApi
  signer: Signer
  checkWallet: (step: LiFiStepExtended) => void
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
