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

/**
 * Whether the step carries typed data of the legacy gasless relayer.
 *
 * @deprecated The legacy gasless relayer service is shut down, and a step of
 * the new gasless flow has no typed data at routes time. Use `isGaslessStep`
 * from `@lifi/sdk`, which detects the relay fee.
 */
export function isGaslessStep(
  step: LiFiStepExtended | LiFiStep,
  chain?: ExtendedChain
): step is RelayerStep {
  return !!step.typedData?.some((typedData) =>
    isGaslessTypedData(typedData, chain)
  )
}
