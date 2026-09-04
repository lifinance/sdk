import type { LiFiStep } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { hasNonNativePermit } from './hasNonNativePermit.js'

const stepWith = (primaryTypes: string[]): LiFiStep =>
  ({
    typedData: primaryTypes.map((primaryType) => ({ primaryType })),
  }) as unknown as LiFiStep

describe('hasNonNativePermit', () => {
  it('is false with no typedData', () => {
    expect(hasNonNativePermit({} as LiFiStep)).toBe(false)
  })

  it('is false for a native EIP-2612 permit', () => {
    // The SDK consumes 'Permit' itself (encodeNativePermitData) — not caller-owned.
    expect(hasNonNativePermit(stepWith(['Permit']))).toBe(false)
  })

  it('is true for a Permit2 PermitSingle (caller brought its own permit)', () => {
    expect(hasNonNativePermit(stepWith(['PermitSingle']))).toBe(true)
  })

  it('is true when any entry is non-native, even alongside a native one', () => {
    expect(hasNonNativePermit(stepWith(['Permit', 'PermitSingle']))).toBe(true)
  })
})
