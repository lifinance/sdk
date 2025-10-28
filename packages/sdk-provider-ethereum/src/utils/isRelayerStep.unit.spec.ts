import { describe, expect, it } from 'vitest'
import { isRelayerStep } from './isRelayerStep.js'

describe('isRelayerStep', () => {
  const validRelayerStep = {
    id: 'test',
    type: 'lifi',
    tool: 'test',
    action: {},
    estimate: {},
    typedData: [{ domain: {}, types: {}, value: {} }],
  }

  it('should return true when typedData exists and has length', () => {
    expect(isRelayerStep(validRelayerStep as any)).toBe(true)
  })

  it('should return false when typedData is empty array', () => {
    expect(isRelayerStep({ ...validRelayerStep, typedData: [] } as any)).toBe(
      false
    )
  })

  it('should return false when typedData is undefined', () => {
    expect(
      isRelayerStep({ ...validRelayerStep, typedData: undefined } as any)
    ).toBe(false)
  })
})
