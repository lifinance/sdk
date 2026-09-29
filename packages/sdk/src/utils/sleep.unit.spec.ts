import { afterEach, describe, expect, it, vi } from 'vitest'
import { sleep } from './sleep.js'

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('resolves with null when the signal does not abort', async () => {
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(
      controller.signal,
      'removeEventListener'
    )

    await expect(sleep(10, { signal: controller.signal })).resolves.toBeNull()
    expect(removeEventListener).toHaveBeenCalledWith(
      'abort',
      expect.any(Function)
    )
  })

  it('rejects with the abort reason when the signal aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const slept = sleep(1_000, { signal: controller.signal })

    controller.abort(new Error('stop'))

    await expect(slept).rejects.toThrow('stop')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects at once when the signal is already aborted', async () => {
    vi.useFakeTimers()
    const reason = new Error('already')

    await expect(
      sleep(1_000, { signal: AbortSignal.abort(reason) })
    ).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with an AbortError when a signal aborts without a reason', async () => {
    const controller = new AbortController()
    // Older runtimes and polyfills abort without setting `reason`.
    Object.defineProperty(controller.signal, 'reason', { value: undefined })
    const slept = sleep(1_000, { signal: controller.signal })

    controller.abort()

    await expect(slept).rejects.toMatchObject({ name: 'AbortError' })
  })
})
