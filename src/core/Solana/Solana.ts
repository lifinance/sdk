import { ChainType } from '@lifi/types'
import { PublicKey } from '@solana/web3.js'
import type { BaseStepExecutor } from '../BaseStepExecutor.js'
import { getSolanaBalance } from './getSolanaBalance.js'
import type { SolanaProvider, SolanaProviderOptions } from './types.js'

export function Solana(options?: SolanaProviderOptions): SolanaProvider {
  const _options: SolanaProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.SVM
    },
    isAddress(address: string): boolean {
      try {
        new PublicKey(address)
        return true
      } catch (error) {
        return false
      }
    },
    getBalance: getSolanaBalance,
    // options: StepExecutorOptions
    async getStepExecutor(): Promise<BaseStepExecutor> {
      if (!_options.getWalletClient) {
        throw new Error(`getWalletClient is not provided.`)
      }

      // const walletClient = await getWalletClient()

      return null!
    },
    setOptions(options: SolanaProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
