import type { LiFiStepExtended } from '../types.js'
import type { EVMPermitStep } from './types.js'

export function isEVMPermitStep(step: LiFiStepExtended): step is EVMPermitStep {
  const evmStep = step as EVMPermitStep
  return 'permit' in evmStep && 'permitData' in evmStep && 'witness' in evmStep
}
