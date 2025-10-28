import { describe, expect, it } from 'vitest'
import { isStep } from './isStep.js'

describe('isStep', () => {
  const validStep = {
    id: 'test-step',
    type: 'swap',
    tool: 'test-tool',
    action: {
      fromChainId: 1,
      fromAmount: '1000000000000000000',
      fromToken: {
        address: '0x111',
        decimals: 18,
        chainId: 1,
      },
      toChainId: 1,
      toToken: {
        address: '0x222',
        decimals: 18,
        chainId: 1,
      },
    },
    estimate: {
      fromAmount: '1000000000000000000',
      toAmount: '2000000000000000000',
      toAmountMin: '1900000000000000000',
      approvalAddress: '0x333',
    },
  }

  it('should return true for valid step', () => {
    expect(isStep(validStep as any)).toBe(true)
  })

  it('should return false for invalid id', () => {
    expect(isStep({ ...validStep, id: 123 } as any)).toBe(false)
  })

  it('should return false for invalid type', () => {
    expect(isStep({ ...validStep, type: 'invalid' } as any)).toBe(false)
  })

  it('should return false for empty fromAmount', () => {
    const step = {
      ...validStep,
      action: { ...validStep.action, fromAmount: '' },
    }
    expect(isStep(step as any)).toBe(false)
  })

  it('should return false for invalid tool', () => {
    expect(isStep({ ...validStep, tool: 123 } as any)).toBe(false)
  })
})
