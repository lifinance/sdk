import { describe, expect, it, vi } from 'vitest'
import { sleep } from './sleep.js'

describe('sleep', () => {
  it('should wait for specified time', async () => {
    const start = Date.now()
    await sleep(50)
    const end = Date.now()

    expect(end - start).toBeGreaterThanOrEqual(45)
  })

  it('should return null', async () => {
    const result = await sleep(10)
    expect(result).toBeNull()
  })

  it('rejects with the abort reason when the signal is already aborted, without waiting out the delay', async () => {
    const events: string[] = []
    // Any macrotask turn — even a 0ms one — would land before a 60s timer.
    setTimeout(() => events.push('macrotask'), 0)
    const reason = await sleep(60_000, AbortSignal.abort()).then(
      () => {
        events.push('resolved')
        return undefined
      },
      (error: unknown) => {
        events.push('rejected')
        return error
      }
    )
    // No macrotask ran, so sleep rejected without ever starting a timer.
    expect(events).toEqual(['rejected'])
    expect(reason).toMatchObject({ name: 'AbortError' })
  })

  it('rejects with the abort reason when the signal aborts during the delay', async () => {
    const controller = new AbortController()
    const pending = sleep(60_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    // The reason is passed through, not reconstructed.
    await expect(pending).rejects.toBe(controller.signal.reason)
  })

  it('resolves and detaches its abort listener when a live signal never aborts', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const result = await sleep(10, controller.signal)
    expect(result).toBeNull()
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('clears the pending timer when the signal aborts', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const pending = sleep(60_000, controller.signal)
      expect(vi.getTimerCount()).toBe(1)
      controller.abort()
      await expect(pending).rejects.toBe(controller.signal.reason)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
