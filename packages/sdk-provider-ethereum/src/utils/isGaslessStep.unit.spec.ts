import type { ExtendedChain, LiFiStep } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { isGaslessStep } from './isGaslessStep.js'

describe('isGaslessStep', () => {
  it('should return true for gasless step with PermitWitnessTransferFrom', () => {
    const step: LiFiStep = {
      id: 'test',
      type: 'swap',
      action: {
        toToken: { address: '0x123', symbol: 'USDC', decimals: 6 },
        fromToken: { address: '0x456', symbol: 'ETH', decimals: 18 },
        fromChainId: 1,
        toChainId: 1,
        fromAmount: '1000000',
      },
      typedData: [
        {
          primaryType: 'PermitWitnessTransferFrom',
          domain: {},
          types: {},
          message: {},
        },
      ],
    } as any

    expect(isGaslessStep(step)).toBe(true)
  })

  it('should return true when chain has permit2', () => {
    const step: LiFiStep = {
      id: 'test',
      type: 'swap',
      action: {
        toToken: { address: '0x123', symbol: 'USDC', decimals: 6 },
        fromToken: { address: '0x456', symbol: 'ETH', decimals: 18 },
        fromChainId: 1,
        toChainId: 1,
        fromAmount: '1000000',
      },
      typedData: [
        {
          primaryType: 'SomeType',
          domain: {},
          types: {},
          message: { spender: '0x1111111111111111111111111111111111111111' },
        },
      ],
    } as any

    const chain: ExtendedChain = {
      id: 1,
      permit2: '0x1111111111111111111111111111111111111111',
    } as any

    expect(isGaslessStep(step, chain)).toBe(true)
  })

  it('should return false for regular step', () => {
    const step: LiFiStep = {
      id: 'test',
      type: 'swap',
      action: {
        toToken: { address: '0x123', symbol: 'USDC', decimals: 6 },
        fromToken: { address: '0x456', symbol: 'ETH', decimals: 18 },
        fromChainId: 1,
        toChainId: 1,
        fromAmount: '1000000',
      },
      typedData: [],
    } as any

    expect(isGaslessStep(step)).toBe(false)
  })
})
