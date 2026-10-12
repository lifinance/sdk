import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTxErrorDetails } from './fetchTxErrorDetails.js'

// Mock fetch
global.fetch = vi.fn()

// A 32-byte EVM transaction hash.
const TX_HASH = `0x${'ab'.repeat(32)}`

describe('fetchTxErrorDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return response body on success', async () => {
    const mockResponse = { error_message: 'Out of gas' }
    ;(global.fetch as any).mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockResponse),
    })

    const result = await fetchTxErrorDetails(TX_HASH, 1)

    expect(result).toEqual(mockResponse)
  })

  it('should return undefined on error', async () => {
    ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

    const result = await fetchTxErrorDetails(TX_HASH, 1)

    expect(result).toBeUndefined()
  })

  it('should call correct tenderly URL', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce({}),
    })

    await fetchTxErrorDetails(TX_HASH, 1)

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.tenderly.co/api/v1/public-contract/1/tx/${TX_HASH}`
    )
  })

  it('accepts an upper-case hash and a large chain ID', async () => {
    const upperCaseHash = `0x${'AB'.repeat(32)}`
    ;(global.fetch as any).mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce({}),
    })

    await fetchTxErrorDetails(upperCaseHash, 1151111081099710)

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.tenderly.co/api/v1/public-contract/1151111081099710/tx/${upperCaseHash}`
    )
  })

  it.each([
    ['a short hash', '0x123', 1],
    ['a hash that is not hex', `0x${'zz'.repeat(32)}`, 1],
    ['a hash without 0x', 'ab'.repeat(33), 1],
    ['a path in the hash', `0x${'ab'.repeat(31)}/..`, 1],
    ['chain ID 0', TX_HASH, 0],
    ['a negative chain ID', TX_HASH, -1],
    ['a fractional chain ID', TX_HASH, 1.5],
    ['NaN as chain ID', TX_HASH, Number.NaN],
  ])('sends no request for %s', async (_, txHash, chainId) => {
    const result = await fetchTxErrorDetails(
      txHash as string,
      chainId as number
    )

    expect(result).toBeUndefined()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
