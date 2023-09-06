import type { LiFiStep } from '@lifi/types'
import type { BaseStepExecutor } from '../execution/BaseStepExecutor'
import type { StepExecutorOptions } from '../execution/types'

export interface SDKProvider {
  readonly type: ProviderType
  isProviderStep(step: LiFiStep): boolean
  getStepExecutor(options: StepExecutorOptions): Promise<BaseStepExecutor>
}

export enum ProviderType {
  EVM = 'EVM',
  Solana = 'Solana',
}
