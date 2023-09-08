import type { LiFiStep } from '@lifi/types'
import { PublicKey } from '@solana/web3.js'
import type {
  BaseStepExecutor,
  StepExecutorOptions,
} from '../execution/BaseStepExecutor.js'
import type { SDKProvider } from './types.js'
import { ProviderType } from './types.js'

export interface SolanaProviderOptions {
  getWalletClient: () => Promise<unknown>
}

export interface SolanaProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function Solana(options?: SolanaProviderOptions): SolanaProvider {
  let getWalletClient = options?.getWalletClient
  return {
    get type() {
      return ProviderType.Solana
    },
    isProviderStep(step: LiFiStep): boolean {
      try {
        const publickKey = new PublicKey(step.action.fromAddress!)
        const isProviderStep = PublicKey.isOnCurve(publickKey)
        return isProviderStep
      } catch (error) {
        return false
      }
    },
    async getStepExecutor(
      _options: StepExecutorOptions
    ): Promise<BaseStepExecutor> {
      if (!getWalletClient) {
        throw new Error(`getWalletClient is not provided.`)
      }

      // const walletClient = await getWalletClient()

      return null!
    },
    setOptions(options: SolanaProviderOptions) {
      getWalletClient = options.getWalletClient
    },
  }
}

export function isEVM(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ProviderType.Solana
}
