import { getEventListeners } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { withDedupe } from './withDedupe.js'

describe('withDedupe', () => {
  it('should execute function without caching when disabled', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const result = await withDedupe(fn, { enabled: false, id: 'test' })

    expect(result).toBe('result')
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(undefined)
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
    // Without a signal, `fn` gets no signal, as before.
    expect(fn).toHaveBeenCalledWith(undefined)
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

  it('never aborts or restarts a request started by a caller without a signal', async () => {
    const request = deferredRequest()
    const leaving = new AbortController()

    const stayed = withDedupe(request.fn, { id: 'no-signal-first' })
    const left = withDedupe(request.fn, {
      id: 'no-signal-first',
      signal: leaving.signal,
    })
    leaving.abort()
    const later = withDedupe(request.fn, { id: 'no-signal-first' })
    request.resolve('result')

    await expect(left).rejects.toBe(leaving.signal.reason)
    await expect(stayed).resolves.toBe('result')
    await expect(later).resolves.toBe('result')
    expect(request.signal()).toBeUndefined()
    expect(request.fn).toHaveBeenCalledOnce()
  })

  it('starts a new request for the same id once the last one settled', async () => {
    const first = deferredRequest()
    const done = withDedupe(first.fn, { id: 'settled-then-again' })
    first.resolve('first')
    await expect(done).resolves.toBe('first')

    const second = deferredRequest()
    const again = withDedupe(second.fn, { id: 'settled-then-again' })
    second.resolve('second')

    await expect(again).resolves.toBe('second')
    expect(second.fn).toHaveBeenCalledOnce()
  })

  it('lets a call made while the request is being aborted start a new request', async () => {
    const leaving = new AbortController()
    const second = deferredRequest()
    let nested: Promise<string> | undefined
    // The request never settles; its abort handler asks for the same id.
    const fn = (signal?: AbortSignal) => {
      signal?.addEventListener('abort', () => {
        nested = withDedupe(second.fn, { id: 'reentrant' })
      })
      return new Promise<string>(() => {})
    }

    const left = withDedupe(fn, { id: 'reentrant', signal: leaving.signal })
    leaving.abort()
    second.resolve('fresh')

    await expect(left).rejects.toBe(leaving.signal.reason)
    await expect(nested).resolves.toBe('fresh')
    expect(second.fn).toHaveBeenCalledOnce()
  })

  it('adds no handler of its own while only callers without a signal share a request', async () => {
    // Counts the handlers added to each promise, so the test can see ours.
    class CountingPromise<T> extends Promise<T> {
      handlers = 0
      // biome-ignore lint/suspicious/noThenProperty: counts the handlers added to the promise
      override then<A = T, B = never>(
        onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
        onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
      ): Promise<A | B> {
        this.handlers++
        return super.then(onFulfilled, onRejected)
      }
    }
    let resolve!: (value: string) => void
    const fn = () =>
      new CountingPromise<string>((res) => {
        resolve = res
      })

    // Without a handler of ours, a failure every caller ignores stays reported.
    const shared = withDedupe(fn, {
      id: 'no-handler',
    }) as CountingPromise<string>
    withDedupe(fn, { id: 'no-handler' })
    expect(shared.handlers).toBe(0)

    const withSignal = withDedupe(fn, {
      id: 'no-handler',
      signal: new AbortController().signal,
    })
    expect(shared.handlers).toBe(1)
    resolve('result')

    await expect(shared).resolves.toBe('result')
    await expect(withSignal).resolves.toBe('result')
  })

  it('passes a failure of the shared request to every caller', async () => {
    let fail!: (error: Error) => void
    const fn = vi.fn(
      () =>
        new Promise<string>((_, reject) => {
          fail = reject
        })
    )
    const first = new AbortController()
    const second = new AbortController()
    const error = new Error('request failed')

    const results = [
      withDedupe(fn, { id: 'shared-failure', signal: first.signal }),
      withDedupe(fn, { id: 'shared-failure', signal: second.signal }),
      withDedupe(fn, { id: 'shared-failure' }),
    ]
    fail(error)

    for (const result of results) {
      await expect(result).rejects.toBe(error)
    }
    // A listener left on a signal would keep the request alive with it.
    expect(getEventListeners(first.signal, 'abort')).toHaveLength(0)
    expect(getEventListeners(second.signal, 'abort')).toHaveLength(0)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('does not abort a settled request when its caller aborts afterwards', async () => {
    const request = deferredRequest()
    const controller = new AbortController()

    const result = withDedupe(request.fn, {
      id: 'after-settle',
      signal: controller.signal,
    })
    request.resolve('result')
    const value = await result
    controller.abort()

    expect(value).toBe('result')
    expect(request.signal()?.aborted).toBe(false)
  })

  it('lets the first caller leave when fn aborts its signal', async () => {
    const leaving = new AbortController()
    let requestSignal: AbortSignal | undefined
    // The request ignores its signal, so it never settles.
    const fn = (signal?: AbortSignal) => {
      requestSignal = signal
      leaving.abort()
      return new Promise<string>(() => {})
    }

    const left = withDedupe(fn, { id: 'sync-abort', signal: leaving.signal })

    await expect(left).rejects.toBe(leaving.signal.reason)
    expect(requestSignal?.aborted).toBe(true)
    // A listener left on the signal would keep the request alive with it.
    expect(getEventListeners(leaving.signal, 'abort')).toHaveLength(0)
  })

  it('rejects with an AbortError when a signal aborts without a reason', async () => {
    const request = deferredRequest()
    const leaving = new AbortController()
    // Older runtimes and polyfills abort without setting `reason`.
    Object.defineProperty(leaving.signal, 'reason', { value: undefined })

    const left = withDedupe(request.fn, {
      id: 'no-reason',
      signal: leaving.signal,
    })
    leaving.abort()

    await expect(left).rejects.toMatchObject({ name: 'AbortError' })
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
