import { describe, expect, it, vi } from 'vitest'
import * as getSNSAddress from './getSNSAddress.js'
import { resolveSolanaAddress } from './resolveSolanaAddress.js'

describe('resolveSolanaAddress', () => {
  it('should resolve address', async () => {
    const mockAddress = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
    const name = 'test.sol'

    vi.spyOn(getSNSAddress, 'getSNSAddress').mockResolvedValue(mockAddress)

    const result = await resolveSolanaAddress(name)

    expect(result).toBe(mockAddress)
  })

  it('should return undefined when address not found', async () => {
    const name = 'nonexistent.sol'

    vi.spyOn(getSNSAddress, 'getSNSAddress').mockResolvedValue(undefined)

    const result = await resolveSolanaAddress(name)

    expect(result).toBeUndefined()
  })
})
