import type { LiFiStep } from '@lifi/types'

/**
 * The `feeCosts` name of the gasless relay fee. The backend marks every
 * gasless step with it and guarantees that the name does not change.
 */
export const GASLESS_RELAY_FEE_NAME = 'LIFI Gasless Relay Fee'

/**
 * Whether the step executes gasless: the user signs typed data and the LI.FI
 * relayer submits it and pays the gas. The relay fee is the only marker that
 * exists already at routes time, before `/advanced/stepTransaction` adds the
 * typed data.
 */
export function isGaslessStep(step: Pick<LiFiStep, 'estimate'>): boolean {
  return (
    step.estimate?.feeCosts?.some(
      (feeCost) => feeCost.name === GASLESS_RELAY_FEE_NAME
    ) ?? false
  )
}
