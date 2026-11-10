import type { FeeCost, LiFiStep, TypedData } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { GASLESS_RELAY_FEE_NAME, isGaslessStep } from './isGaslessStep.js'

const feeCost = (name: string): FeeCost =>
  ({
    name,
    description: name,
    percentage: '0.001',
    token: {} as FeeCost['token'],
    amount: '1',
    amountUSD: '0.08',
    included: true,
  }) as FeeCost

const stepWith = (
  estimate: Partial<LiFiStep['estimate']>,
  typedData?: TypedData[]
): Pick<LiFiStep, 'estimate' | 'typedData'> => ({
  estimate: estimate as LiFiStep['estimate'],
  typedData,
})

describe('isGaslessStep', () => {
  it('uses the relay fee name the backend publishes', () => {
    expect(GASLESS_RELAY_FEE_NAME).toBe('LIFI Gasless Relay Fee')
  })

  it('returns true when estimate.feeCosts has the relay fee', () => {
    const step = stepWith({
      feeCosts: [feeCost('LIFI Fixed Fee'), feeCost('LIFI Gasless Relay Fee')],
    })
    expect(isGaslessStep(step)).toBe(true)
  })

  it('returns false for a step without feeCosts', () => {
    expect(isGaslessStep(stepWith({}))).toBe(false)
  })

  it('returns false for a step with other included fees only', () => {
    const step = stepWith({ feeCosts: [feeCost('LIFI Fixed Fee')] })
    expect(isGaslessStep(step)).toBe(false)
  })

  it('ignores typedData: a PermitWitnessTransferFrom step without the fee is not gasless', () => {
    const step = stepWith({ feeCosts: [] }, [
      {
        primaryType: 'PermitWitnessTransferFrom',
        domain: {},
        types: {},
        message: {},
      } as unknown as TypedData,
    ])
    expect(isGaslessStep(step)).toBe(false)
  })
})
