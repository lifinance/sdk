import { describe, expect, it, vi } from 'vitest'
import { isPsbtFinalized } from './isPsbtFinalized.js'

describe('isPsbtFinalized', () => {
  it('should return true when psbt.extractTransaction() succeeds', () => {
    const finalizedPsbt = {
      extractTransaction: vi.fn().mockReturnValue({}),
    } as any

    expect(isPsbtFinalized(finalizedPsbt)).toBe(true)
  })

  it('should return false when psbt.extractTransaction() throws', () => {
    const unsignedPsbt = {
      extractTransaction: vi.fn().mockImplementation(() => {
        throw new Error('Not finalized')
      }),
    } as any

    expect(isPsbtFinalized(unsignedPsbt)).toBe(false)
  })
})
