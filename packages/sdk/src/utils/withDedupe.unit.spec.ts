import { describe, expect, it, vi } from 'vitest'
import { withDedupe } from './withDedupe.js'

describe('withDedupe', () => {
  it('should execute function without caching when disabled', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const result = await withDedupe(fn, { enabled: false, id: 'test' })

    expect(result).toBe('result')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('should cache and dedupe identical requests', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const id = 'test-id'

    const promise1 = withDedupe(fn, { enabled: true, id })
    const promise2 = withDedupe(fn, { enabled: true, id })

    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(result1).toBe('result')
    expect(result2).toBe('result')
    expect(fn).toHaveBeenCalledOnce()
  })
})
