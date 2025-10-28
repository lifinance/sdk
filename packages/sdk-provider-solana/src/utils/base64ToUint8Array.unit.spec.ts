import { describe, expect, it } from 'vitest'
import { base64ToUint8Array } from './base64ToUint8Array.js'

describe('base64ToUint8Array', () => {
  it('should convert base64 string to Uint8Array', () => {
    const base64 = 'SGVsbG8gV29ybGQ=' // "Hello World"
    const result = base64ToUint8Array(base64)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should convert empty base64 string', () => {
    const base64 = ''
    const result = base64ToUint8Array(base64)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(0)
  })
})
