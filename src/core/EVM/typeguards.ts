import type { ExtendedChain, LiFiStep } from '@lifi/types'
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
  step: LiFiStepExtended | LiFiStep,
  chain?: ExtendedChain
): step is RelayerStep {
  return (
    !!step.typedData?.some(
      (p) => p.primaryType === 'PermitWitnessTransferFrom'
    ) ||
    !!(
      chain && step.typedData?.some((p) => p.message.spender === chain?.permit2)
    )
  )
}
