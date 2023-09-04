import type { LiFiStep } from '@lifi/types'
import { isAddress, type WalletClient } from 'viem'
import type { BaseStepExecutor } from '../execution/BaseStepExecutor'
import { EVMStepExecutor } from '../execution/EVMStepExecutor'
import type { StepExecutorOptions } from '../execution/types'
import { BaseProvider } from './BaseProvider'

export type GetEVMWalletClient = () => Promise<WalletClient>

export interface EVMProviderOptions {
  getWalletClient: GetEVMWalletClient
}

export class EVMProvider extends BaseProvider {
  getWalletClient?: GetEVMWalletClient

  constructor(options?: EVMProviderOptions) {
    super()
    this.getWalletClient = options?.getWalletClient
  }

  isProviderStep(step: LiFiStep): boolean {
    const isProviderStep = isAddress(step.action.fromAddress!)
    return isProviderStep
  }

  async getStepExecutor(
    options: StepExecutorOptions
  ): Promise<BaseStepExecutor> {
    if (!this.getWalletClient) {
      throw new Error(`getWalletClient is not provided.`)
    }

    const walletClient = await this.getWalletClient()

    const executor = new EVMStepExecutor({ walletClient, ...options })

    return executor
  }

  setOptions(options: EVMProviderOptions) {
    this.getWalletClient = options.getWalletClient
  }
}
