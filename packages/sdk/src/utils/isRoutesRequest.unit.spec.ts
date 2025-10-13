import { describe, expect, it } from 'vitest'
import { isRoutesRequest } from './isRoutesRequest.js'

describe('isRoutesRequest', () => {
  const validRequest = {
    fromChainId: 1,
    fromAmount: '1000000000000000000',
    fromTokenAddress: '0x111',
    toChainId: 1,
    toTokenAddress: '0x222',
    options: { slippage: 0.001 },
  }

  it('should return true for valid request', () => {
    expect(isRoutesRequest(validRequest)).toBe(true)
  })

  it('should return true for request without options', () => {
    expect(isRoutesRequest({ ...validRequest, options: undefined })).toBe(true)
  })

  it('should return false for invalid chainId', () => {
    expect(isRoutesRequest({ ...validRequest, fromChainId: '1' } as any)).toBe(
      false
    )
  })

  it('should return false for empty fromAmount', () => {
    expect(isRoutesRequest({ ...validRequest, fromAmount: '' })).toBe(false)
  })

  it('should return false for empty token address', () => {
    expect(isRoutesRequest({ ...validRequest, fromTokenAddress: '' })).toBe(
      false
    )
  })

  it('should return false for invalid slippage', () => {
    expect(
      isRoutesRequest({
        ...validRequest,
        options: { slippage: 'invalid' },
      } as any)
    ).toBe(false)
  })
})
