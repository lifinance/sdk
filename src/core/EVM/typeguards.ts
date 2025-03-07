import type { LiFiStep } from '@lifi/types'
import type { LiFiStepExtended } from '../types.js'
import type { EVMPermitStep } from './types.js'

export function isRelayerStep(
  step: LiFiStepExtended | LiFiStep
): step is EVMPermitStep {
  const evmStep = step as EVMPermitStep
  return 'permits' in evmStep && evmStep.permits?.length > 0
}
