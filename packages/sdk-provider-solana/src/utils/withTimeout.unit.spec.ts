import { describe, expect, it, vi } from 'vitest'
import { withTimeout } from './withTimeout.js'

describe('withTimeout', () => {
  it('should resolve before timeout', async () => {
    const fastFn = vi.fn().mockResolvedValue('success')
    const result = await withTimeout(fastFn, { timeout: 1000 })

    expect(result).toBe('success')
    expect(fastFn).toHaveBeenCalled()
  })

  it('should reject on timeout', async () => {
    const slowFn = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => setTimeout(() => resolve('slow'), 2000))
    })

    await expect(withTimeout(slowFn, { timeout: 100 })).rejects.toThrowError(
      'timed out'
    )
  })

  it('should use abort signal when enabled', async () => {
    const fnWithSignal = vi
      .fn()
      .mockImplementation(({ signal }: { signal: AbortSignal | null }) => {
        return new Promise((resolve, reject) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              const error = new Error('timed out')
              error.name = 'AbortError'
              reject(error)
            })
            setTimeout(() => resolve('not aborted'), 100)
          } else {
            resolve('no signal')
          }
        })
      })

    await expect(
      withTimeout(fnWithSignal, { timeout: 50, signal: true })
    ).rejects.toThrowError('timed out')
  })
})
