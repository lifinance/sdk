import type { LiFiStep } from '@lifi/types'
import type { BaseStepExecutor } from '../execution/BaseStepExecutor'
import type { StepExecutorOptions } from '../execution/types'

export abstract class BaseProvider {
  abstract isProviderStep(step: LiFiStep): boolean
  abstract getStepExecutor(
    options: StepExecutorOptions
  ): Promise<BaseStepExecutor>
}
