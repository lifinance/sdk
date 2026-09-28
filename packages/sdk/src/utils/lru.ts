/**
 * Map with a LRU (Least recently used) policy.
 * Copied from viem 2.56.9 (`src/utils/lru.ts`).
 *
 * https://en.wikipedia.org/wiki/Cache_replacement_policies#LRU
 */
export class LruMap<value = unknown> extends Map<string, value> {
  maxSize: number

  constructor(size: number) {
    super()
    this.maxSize = size
  }

  override get(key: string): value | undefined {
    const value = super.get(key)
    if (super.has(key)) {
      super.delete(key)
      super.set(key, value as value)
    }
    return value
  }

  override set(key: string, value: value): this {
    if (super.has(key)) {
      super.delete(key)
    }
    super.set(key, value)
    if (this.maxSize && this.size > this.maxSize) {
      // `super.keys()`, not `this.keys()`: on iOS 18 the subclass iterator
      // can yield `undefined`, and the map then grows without limit.
      const firstKey = super.keys().next().value
      if (firstKey !== undefined) {
        super.delete(firstKey)
      }
    }
    return this
  }
}
