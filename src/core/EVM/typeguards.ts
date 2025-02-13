import type { LiFiStep } from '@lifi/types'
import type { LiFiStepExtended } from '../types.js'
import type { EVMPermitStep } from './types.js'

export function isRelayerStep(
  step: LiFiStepExtended | LiFiStep
): step is EVMPermitStep {
  const evmStep = step as EVMPermitStep
  return 'permit' in evmStep && 'permitData' in evmStep && 'witness' in evmStep
}
