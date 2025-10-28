import { describe, expect, it, vi } from 'vitest'
import * as getSuiNSAddress from './getSuiNSAddress.js'
import { resolveSuiAddress } from './resolveSuiAddress.js'

describe('resolveSuiAddress', () => {
  it('should resolve address', async () => {
    const mockAddress = '0x123456'
    const name = 'test.sui'

    vi.spyOn(getSuiNSAddress, 'getSuiNSAddress').mockResolvedValue(mockAddress)

    const result = await resolveSuiAddress(name)

    expect(result).toBe(mockAddress)
  })

  it('should return undefined when address not found', async () => {
    const name = 'nonexistent.sui'

    vi.spyOn(getSuiNSAddress, 'getSuiNSAddress').mockResolvedValue(undefined)

    const result = await resolveSuiAddress(name)

    expect(result).toBeUndefined()
  })
})
