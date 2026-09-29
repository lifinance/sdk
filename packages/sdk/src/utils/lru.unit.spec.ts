import { describe, expect, it } from 'vitest'
import { LruMap } from './lru.js'

describe('LruMap', () => {
  it('evicts the oldest entries once it is full', () => {
    const cache = new LruMap(5)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)
    cache.set('e', 5)
    cache.set('f', 6)
    cache.set('g', 7)
    expect(cache.size).toBe(5)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(false)
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
    expect(cache.get('e')).toBe(5)
    expect(cache.get('f')).toBe(6)
    expect(cache.get('g')).toBe(7)
  })

  it('keeps an entry that was read', () => {
    const cache = new LruMap(5)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)
    cache.set('e', 5)
    cache.get('a')
    cache.set('f', 6)
    cache.set('g', 7)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(false)
    expect(cache.has('d')).toBe(true)
  })

  it('keeps an entry that was set again', () => {
    const cache = new LruMap(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('a', 10)
    cache.set('d', 4)
    expect(cache.get('a')).toBe(10)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  it('keeps an entry whose value is undefined when it is read', () => {
    const cache = new LruMap<number | undefined>(2)
    cache.set('a', undefined)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  // Regression guards for the iOS 18 iterator bug. It does not reproduce
  // in Node, so these pass on the old code too.
  it('stays within maxSize under heavy load', () => {
    const cache = new LruMap<boolean>(100)
    for (let i = 0; i < 10_000; i++) {
      cache.set(`key${i}`, true)
    }
    expect(cache.size).toBe(100)
    expect(cache.has('key0')).toBe(false)
    expect(cache.has('key9899')).toBe(false)
    expect(cache.has('key9900')).toBe(true)
    expect(cache.has('key9999')).toBe(true)
  })

  it('evicts an empty-string key', () => {
    const cache = new LruMap<number>(1)
    cache.set('', 1)
    cache.set('x', 2)
    expect(cache.has('')).toBe(false)
    expect(cache.has('x')).toBe(true)
  })
})
