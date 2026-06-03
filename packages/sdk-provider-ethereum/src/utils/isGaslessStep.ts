import type { ExtendedChain, LiFiStep, LiFiStepExtended } from '@lifi/sdk'
import type { RelayerStep } from '../types.js'

export function isGaslessStep(
  step: LiFiStepExtended | LiFiStep,
  chain?: ExtendedChain
): step is RelayerStep {
  return (
    !!step.typedData?.some(
      (p) => p.primaryType === 'PermitWitnessTransferFrom'
    ) ||
    !!(
      chain?.permit2 &&
      step.typedData?.some((p) => p.message.spender === chain.permit2)
    )
  )
}
