/**
 * Map with a LRU (Least recently used) policy.
 *
 * https://en.wikipedia.org/wiki/Cache_replacement_policies#LRU
 */
class LruMap<value = unknown> extends Map<string, value> {
  maxSize: number

  constructor(size: number) {
    super()
    this.maxSize = size
  }

  override set(key: string, value: value) {
    super.set(key, value)
    if (this.maxSize && this.size > this.maxSize) {
      this.delete(this.keys().next().value!)
    }
    return this
  }
}

/** @internal */
const promiseCache = /*#__PURE__*/ new LruMap<Promise<any>>(8192)

type WithDedupeOptions = {
  enabled?: boolean | undefined
  id?: string | undefined
}

/** Deduplicates in-flight promises. */
export function withDedupe<T>(
  fn: () => Promise<T>,
  { enabled = true, id }: WithDedupeOptions
): Promise<T> {
  if (!enabled || !id) {
    return fn()
  }
  if (promiseCache.get(id)) {
    return promiseCache.get(id)!
  }
  const promise = fn().finally(() => promiseCache.delete(id))
  promiseCache.set(id, promise)
  return promise
}
