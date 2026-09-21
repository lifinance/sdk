import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import type { RelayerStep } from '../types.js'

/** Whether one typed-data entry is one a relayer must sign and submit. */
export function isGaslessTypedData(
  typedData: TypedData,
  chain?: ExtendedChain
): boolean {
  const spender = typedData.message?.spender
  return (
    typedData.primaryType === 'PermitWitnessTransferFrom' ||
    (!!chain?.permit2 &&
      typeof spender === 'string' &&
      spender.toLowerCase() === chain.permit2.toLowerCase())
  )
}

export function isGaslessStep(
  step: LiFiStepExtended | LiFiStep,
  chain?: ExtendedChain
): step is RelayerStep {
  return !!step.typedData?.some((typedData) =>
    isGaslessTypedData(typedData, chain)
  )
}
