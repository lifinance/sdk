import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTxErrorDetails } from './fetchTxErrorDetails.js'

// Mock fetch
global.fetch = vi.fn()

describe('fetchTxErrorDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return response body on success', async () => {
    const mockResponse = { error_message: 'Out of gas' }
    ;(global.fetch as any).mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockResponse),
    })

    const result = await fetchTxErrorDetails('0x123', 1)

    expect(result).toEqual(mockResponse)
  })

  it('should return undefined on error', async () => {
    ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

    const result = await fetchTxErrorDetails('0x123', 1)

    expect(result).toBeUndefined()
  })

  it('should call correct tenderly URL', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce({}),
    })

    await fetchTxErrorDetails('0x123abc', 1)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tenderly.co/api/v1/public-contract/1/tx/0x123abc'
    )
  })
})
