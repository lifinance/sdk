import type { LiFiStep, LiFiStepExtended } from '@lifi/sdk'

export function isContractCallStep(step: LiFiStepExtended | LiFiStep): boolean {
  return step.includedSteps.some((s) => s.type === 'custom')
}
