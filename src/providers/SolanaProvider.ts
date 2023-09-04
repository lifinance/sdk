import type { LiFiStep } from '@lifi/types'
import { PublicKey } from '@solana/web3.js'
import type { BaseStepExecutor } from '../execution/BaseStepExecutor'
import type { StepExecutorOptions } from '../execution/types'
import { BaseProvider } from './BaseProvider'

export type GetSolanaWalletClient = () => Promise<unknown>

export interface SolanaProviderOptions {
  getWalletClient: GetSolanaWalletClient
}

export class SolanaProvider extends BaseProvider {
  getWalletClient?: GetSolanaWalletClient

  constructor(options?: SolanaProviderOptions) {
    super()
    this.getWalletClient = options?.getWalletClient
  }

  isProviderStep(step: LiFiStep): boolean {
    try {
      const publickKey = new PublicKey(step.action.fromAddress!)
      const isProviderStep = PublicKey.isOnCurve(publickKey)
      return isProviderStep
    } catch (error) {
      return false
    }
  }

  async getStepExecutor(
    options: StepExecutorOptions
  ): Promise<BaseStepExecutor> {
    if (!this.getWalletClient) {
      throw new Error(`getWalletClient is not provided.`)
    }

    const walletClient = await this.getWalletClient()

    return null!
  }

  setOptions(options: SolanaProviderOptions) {
    this.getWalletClient = options.getWalletClient
  }
}
