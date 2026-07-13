import { LiFiErrorCode } from '@lifi/sdk'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { assertValidSignature, isValidSignature } from './isValidSignature.js'

const SIG_65_BYTES = `0x${'11'.repeat(65)}` as Hex
const SIG_64_BYTES_COMPACT = `0x${'11'.repeat(64)}` as Hex
const SIG_SMART_ACCOUNT = `0x${'11'.repeat(300)}` as Hex

describe('isValidSignature', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['0x', false],
    ['not-hex', false],
    [SIG_65_BYTES, true],
    // EIP-2098 compact signature
    [SIG_64_BYTES_COMPACT, true],
    // Smart account (ERC-1271) signatures can be arbitrary length
    [SIG_SMART_ACCOUNT, true],
  ] as [
    Hex | null | undefined,
    boolean,
  ][])('isValidSignature(%s) → %s', (signature, expected) => {
    expect(isValidSignature(signature)).toBe(expected)
  })
})

describe('assertValidSignature', () => {
  it('throws a TransactionError with the SignatureRejected code for a nullish signature', () => {
    expect(() => assertValidSignature(null)).toThrowError(
      expect.objectContaining({
        name: 'TransactionError',
        code: LiFiErrorCode.SignatureRejected,
      })
    )
  })

  it('does not throw for a valid signature', () => {
    expect(() => assertValidSignature(SIG_65_BYTES)).not.toThrow()
  })
})
