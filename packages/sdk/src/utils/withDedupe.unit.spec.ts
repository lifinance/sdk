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
    // Callers without a signal get `fn` called exactly as before.
    expect(fn).toHaveBeenCalledWith()
  })
})

describe('withDedupe with abort signals', () => {
  /** A request that settles only when told to, and records its signal. */
  const deferredRequest = () => {
    let resolve!: (value: string) => void
    let signal: AbortSignal | undefined
    const fn = vi.fn((requestSignal?: AbortSignal) => {
      signal = requestSignal
      return new Promise<string>((res, rej) => {
        resolve = res
        requestSignal?.addEventListener('abort', () =>
          rej(requestSignal.reason)
        )
      })
    })
    return {
      fn,
      resolve: (value: string) => resolve(value),
      signal: () => signal,
    }
  }

  it('keeps the shared request alive when one of its callers aborts', async () => {
    const request = deferredRequest()
    const leaving = new AbortController()

    const left = withDedupe(request.fn, {
      id: 'leave-one',
      signal: leaving.signal,
    })
    const stayed = withDedupe(request.fn, {
      id: 'leave-one',
      signal: new AbortController().signal,
    })
    leaving.abort()
    request.resolve('result')

    await expect(left).rejects.toBe(leaving.signal.reason)
    await expect(stayed).resolves.toBe('result')
    expect(request.signal()?.aborted).toBe(false)
    expect(request.fn).toHaveBeenCalledOnce()
  })

  it('aborts the shared request once every caller has aborted', async () => {
    const request = deferredRequest()
    const first = new AbortController()
    const second = new AbortController()

    const results = [
      withDedupe(request.fn, { id: 'leave-all', signal: first.signal }),
      withDedupe(request.fn, { id: 'leave-all', signal: second.signal }),
    ]
    first.abort()
    expect(request.signal()?.aborted).toBe(false)
    second.abort()

    expect(request.signal()?.aborted).toBe(true)
    await expect(results[0]).rejects.toBe(first.signal.reason)
    await expect(results[1]).rejects.toBe(second.signal.reason)
  })

  it('never aborts a request shared with a caller that has no signal', async () => {
    const request = deferredRequest()
    const leaving = new AbortController()

    const left = withDedupe(request.fn, {
      id: 'no-signal',
      signal: leaving.signal,
    })
    const stayed = withDedupe(request.fn, { id: 'no-signal' })
    leaving.abort()
    request.resolve('result')

    await expect(left).rejects.toBe(leaving.signal.reason)
    await expect(stayed).resolves.toBe('result')
    expect(request.signal()?.aborted).toBe(false)
  })

  it('starts a new request for a caller arriving after every caller aborted', async () => {
    // The first request ignores its abort and settles late.
    let settleFirst!: (value: string) => void
    const first = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          settleFirst = resolve
        })
    )
    const leaving = new AbortController()
    const left = withDedupe(first, { id: 'rejoin', signal: leaving.signal })
    leaving.abort()
    await expect(left).rejects.toBe(leaving.signal.reason)

    const second = deferredRequest()
    const arrived = withDedupe(second.fn, { id: 'rejoin' })
    settleFirst('stale')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const joined = withDedupe(second.fn, { id: 'rejoin' })
    second.resolve('fresh')

    await expect(arrived).resolves.toBe('fresh')
    await expect(joined).resolves.toBe('fresh')
    expect(first).toHaveBeenCalledOnce()
    expect(second.fn).toHaveBeenCalledOnce()
  })

  it('rejects a caller whose signal is already aborted without a request', async () => {
    const request = deferredRequest()
    const signal = AbortSignal.abort()

    await expect(
      withDedupe(request.fn, { id: 'pre-aborted', signal })
    ).rejects.toBe(signal.reason)
    expect(request.fn).not.toHaveBeenCalled()
  })

  it('hands the caller its own signal when deduplication is off', async () => {
    const request = deferredRequest()
    const signal = new AbortController().signal

    const result = withDedupe(request.fn, { enabled: false, id: 'off', signal })
    request.resolve('result')

    await expect(result).resolves.toBe('result')
    expect(request.signal()).toBe(signal)
  })
})
