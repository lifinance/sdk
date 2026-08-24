import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { abortableSleep } from './abortableSleep.js'

describe('abortableSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves when the delay elapses', async () => {
    const controller = new AbortController()
    let slept = false
    const sleeping = abortableSleep(50, controller.signal).then(() => {
      slept = true
    })

    await vi.advanceTimersByTimeAsync(50)
    await sleeping

    expect(slept).toBe(true)
  })

  it('resolves as soon as the signal aborts, and clears its timer', async () => {
    // The detached loops in `pollUntilDeadline` and `confirmSignature` sleep
    // between iterations. A plain `sleep` keeps its timer alive for the whole
    // interval after the branch has already ended, so a finished race left one
    // live timer per RPC holding the Node event loop open.
    const controller = new AbortController()
    const sleeping = abortableSleep(10_000, controller.signal)

    controller.abort()
    await sleeping

    expect(vi.getTimerCount()).toBe(0)
  }, 1_000)

  it('returns immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await abortableSleep(10_000, controller.signal)

    expect(vi.getTimerCount()).toBe(0)
  }, 1_000)

  it('detaches its abort listener once the delay elapses', async () => {
    // A branch sleeps many times against one signal. A listener left behind on
    // every pass is an unbounded leak on a long-lived signal.
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(
      controller.signal,
      'removeEventListener'
    )

    const sleeping = abortableSleep(50, controller.signal)
    await vi.advanceTimersByTimeAsync(50)
    await sleeping

    expect(removeEventListener).toHaveBeenCalledOnce()
  })
})
