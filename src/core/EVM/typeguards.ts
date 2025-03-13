import type { LiFiStep } from '@lifi/types'
import type { LiFiStepExtended } from '../types.js'

type RelayerStep = (LiFiStepExtended | LiFiStep) & {
  typedData: NonNullable<(LiFiStepExtended | LiFiStep)['typedData']>
}

export function isRelayerStep(
  step: LiFiStepExtended | LiFiStep
): step is RelayerStep {
  return !!step.typedData && step.typedData.length > 0
}

export function isGaslessStep(
  step: LiFiStepExtended | LiFiStep
): step is RelayerStep {
  return !!step.typedData?.find(
    (p) => p.primaryType === 'PermitWitnessTransferFrom'
  )
}
