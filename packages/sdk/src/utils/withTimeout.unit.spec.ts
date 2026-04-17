import { describe, expect, it } from 'vitest'
import { sleep } from './sleep.js'
import { withTimeout } from './withTimeout.js'

describe('withTimeout', () => {
  it('resolves with the function result when it finishes before the timeout', async () => {
    const result = await withTimeout(async () => 'ok', { timeout: 100 })
    expect(result).toBe('ok')
  })

  it('rejects with the supplied error instance when the timeout fires', async () => {
    const errorInstance = new Error('boom')
    await expect(
      withTimeout(
        async () => {
          await sleep(50)
          return 'never'
        },
        { timeout: 5, errorInstance }
      )
    ).rejects.toBe(errorInstance)
  })

  it('aborts via signal when signal: true and the timeout fires', async () => {
    const errorInstance = new Error('aborted')
    await expect(
      withTimeout(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' })
              )
            )
          }),
        { timeout: 5, signal: true, errorInstance }
      )
    ).rejects.toBe(errorInstance)
  })

  it('propagates the function error when it rejects before the timeout', async () => {
    const inner = new Error('inner')
    await expect(
      withTimeout(
        async () => {
          throw inner
        },
        { timeout: 100 }
      )
    ).rejects.toBe(inner)
  })
})
