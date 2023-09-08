import type { LiFiStep } from '@lifi/types'
import type {
  BaseStepExecutor,
  StepExecutorOptions,
} from '../execution/BaseStepExecutor.js'

export interface SDKProvider {
  readonly type: ProviderType
  isProviderStep(step: LiFiStep): boolean
  getStepExecutor(options: StepExecutorOptions): Promise<BaseStepExecutor>
}

export enum ProviderType {
  EVM = 'EVM',
  Solana = 'Solana',
}
