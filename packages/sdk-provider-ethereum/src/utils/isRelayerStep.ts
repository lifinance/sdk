import type { LiFiStep, LiFiStepExtended } from '@lifi/sdk'
import type { RelayerStep } from '../types.js'

export function isRelayerStep(
  step: LiFiStepExtended | LiFiStep
): step is RelayerStep {
  return !!step.typedData && step.typedData.length > 0
}
