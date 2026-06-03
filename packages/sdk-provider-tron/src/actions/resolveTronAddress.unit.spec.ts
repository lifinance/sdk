import { describe, expect, it } from 'vitest'
import { resolveTronAddress } from './resolveTronAddress.js'

describe('resolveTronAddress', () => {
  it('should return the address as-is', async () => {
    const address = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'

    expect(await resolveTronAddress(address)).toBe(address)
  })
})
