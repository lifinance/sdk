/**
 * Map with a LRU (Least recently used) policy.
 *
 * https://en.wikipedia.org/wiki/Cache_replacement_policies#LRU
 */
export class LruMap<value = unknown> extends Map<string, value> {
  maxSize: number

  constructor(size: number) {
    super()
    this.maxSize = size
  }

  override set(key: string, value: value): this {
    super.set(key, value)
    if (this.maxSize && this.size > this.maxSize) {
      this.delete(this.keys().next().value!)
    }
    return this
  }
}

type InFlight = {
  promise: Promise<any>
  /** Absent when the first caller had no signal: then nothing can abort it. */
  controller?: AbortController | undefined
  /** Callers that have not aborted. One without a signal never aborts. */
  waiting: number
}

/** @internal */
const promiseCache = /*#__PURE__*/ new LruMap<InFlight>(8192)

type WithDedupeOptions = {
  enabled?: boolean | undefined
  id?: string | undefined
  /** Lets this caller leave a shared request without aborting it for others. */
  signal?: AbortSignal | undefined
}

/**
 * Deduplicates in-flight promises.
 *
 * When the first caller passes a signal, `fn` receives the signal to hand on
 * to its request. A caller that aborts leaves the shared request at once; the
 * request itself is aborted only when every caller has aborted.
 */
export function withDedupe<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  { enabled = true, id, signal }: WithDedupeOptions
): Promise<T> {
  if (!enabled || !id) {
    return fn(signal)
  }
  if (signal?.aborted) {
    return Promise.reject(abortReason(signal))
  }
  let inFlight = promiseCache.get(id)
  if (!inFlight) {
    const controller = signal ? new AbortController() : undefined
    const created: InFlight = { controller, waiting: 0, promise: undefined! }
    created.promise = (controller ? fn(controller.signal) : fn()).finally(
      () => {
        if (promiseCache.get(id) === created) {
          promiseCache.delete(id)
        }
      }
    )
    promiseCache.set(id, created)
    inFlight = created
  }
  return join<T>(id, inFlight, signal)
}

function join<T>(
  id: string,
  inFlight: InFlight,
  signal: AbortSignal | undefined
): Promise<T> {
  inFlight.waiting++
  if (!signal) {
    return inFlight.promise
  }
  return new Promise<T>((resolve, reject) => {
    const leave = () => {
      const reason = abortReason(signal)
      inFlight.waiting--
      reject(reason)
      if (inFlight.waiting === 0) {
        // A caller arriving now must start a new request, not join this one.
        if (promiseCache.get(id) === inFlight) {
          promiseCache.delete(id)
        }
        inFlight.controller?.abort(reason)
      }
    }
    signal.addEventListener('abort', leave, { once: true })
    inFlight.promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', leave))
  })
}

/** Older runtimes and polyfills can abort a signal without a `reason`. */
const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ??
  Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
