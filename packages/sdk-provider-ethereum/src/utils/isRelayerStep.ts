import type { LiFiStep, LiFiStepExtended } from '@lifi/sdk'
import type { RelayerStep } from '../types.js'

/**
 * Whether the step carries any typed data at all.
 *
 * @deprecated Presence of typed data does not tell you how a step executes: a
 * caller-supplied Permit2 intent is signed inline and sent by the user, while a
 * gasless intent goes to the relayer. Use `isGaslessStep` to ask who pays the
 * gas. Inside this package, execution routing uses the typed-data lane
 * classifier instead. One internal caller remains in `getUpdatedStep.ts`,
 * paired with `isGaslessStep`; it is removed in the next major.
 */
export function isRelayerStep(
  step: LiFiStepExtended | LiFiStep
): step is RelayerStep {
  return !!step.typedData && step.typedData.length > 0
}
