import { getBase64EncodedWireTransaction, type Transaction } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { base64ToUint8Array } from './base64ToUint8Array.js'
import { getTransactionLifetime } from './getTransactionLifetime.js'
import {
  SWAP_TRANSACTION_BASE64,
  SWAP_TRANSACTION_BLOCKHASH,
} from './getTransactionLifetime.unit.mock.js'
import {
  decodeStoredTransactions,
  encodeStoredTransactions,
  isStoredBundle,
  type StoredTransactions,
} from './storedTransactions.js'
import {
  signatureFilledWith,
  signedNonceTransactionBase64,
  signedSwapTransactionBase64,
} from './storedTransactions.unit.mock.js'

/** Decodes, and fails loudly when the value does not decode. */
const decoded = (txHex: string): StoredTransactions => {
  const stored = decodeStoredTransactions(txHex)
  if (!stored) {
    throw new Error('expected the stored value to decode')
  }
  return stored
}

const wireOf = (transaction: Transaction): string =>
  getBase64EncodedWireTransaction(transaction)

describe('storedTransactions', () => {
  it('stores a single transaction as its base64 wire bytes', () => {
    const wire = signedSwapTransactionBase64(7)

    expect(encodeStoredTransactions([base64ToUint8Array(wire)], false)).toBe(
      wire
    )
    expect(isStoredBundle(wire)).toBe(false)
  })

  it('decodes a single transaction back to exactly the stored bytes', async () => {
    // A resend re-encodes the decoded transaction. It must be the signed
    // bytes themselves, not a rebuild.
    const txHex = signedSwapTransactionBase64(7)

    const stored = decoded(txHex)

    expect(stored.isBundle).toBe(false)
    expect(stored.signature).toBe(signatureFilledWith(7))
    expect(stored.transactions.map(wireOf)).toEqual([txHex])
    await expect(
      getTransactionLifetime(stored.transactions[0])
    ).resolves.toEqual({
      kind: 'blockhash',
      blockhash: SWAP_TRANSACTION_BLOCKHASH,
    })
  })

  it('stores a bundle as a JSON array and keeps it a bundle through the round trip', async () => {
    const wires = [
      signedSwapTransactionBase64(7),
      signedNonceTransactionBase64(9),
    ]

    const txHex = encodeStoredTransactions(wires.map(base64ToUint8Array), true)

    expect(txHex).toBe(JSON.stringify(wires))
    expect(isStoredBundle(txHex)).toBe(true)
    const stored = decoded(txHex)
    expect(stored.isBundle).toBe(true)
    // The first transaction's signature is the action's `txHash`.
    expect(stored.signature).toBe(signatureFilledWith(7))
    expect(stored.transactions.map(wireOf)).toEqual(wires)
    await expect(
      getTransactionLifetime(stored.transactions[1])
    ).resolves.toEqual({ kind: 'nonce' })
  })

  it('keeps a one-element bundle a bundle', () => {
    // The leading `[` is the only record of `isBundleExecution` a resume
    // gets. Unwrapped, a one-transaction bundle would go out through
    // `sendTransaction` instead of `sendBundle`.
    const wire = signedSwapTransactionBase64(7)

    const txHex = encodeStoredTransactions([base64ToUint8Array(wire)], true)

    expect(txHex).toBe(`["${wire}"]`)
    expect(isStoredBundle(txHex)).toBe(true)
    expect(decoded(txHex).isBundle).toBe(true)
  })

  it('rejects stored bytes whose fee payer signature is missing', () => {
    // The captured transaction's fee payer slot is all zeros.
    expect(decodeStoredTransactions(SWAP_TRANSACTION_BASE64)).toBeUndefined()
  })

  it('rejects a bundle when any entry lacks its fee payer signature', () => {
    expect(
      decodeStoredTransactions(
        JSON.stringify([
          signedSwapTransactionBase64(7),
          SWAP_TRANSACTION_BASE64,
        ])
      )
    ).toBeUndefined()
  })

  it.each([
    ['a value that is not base64', '%%%'],
    ['base64 that is no transaction', 'AAAA'],
    ['broken JSON', '["unterminated'],
    ['a JSON object', '{"0":"AAAA"}'],
    ['a JSON string', '"AAAA"'],
    ['an empty bundle', '[]'],
    ['a bundle of non-strings', '[1,2]'],
    [
      'a bundle with one non-string entry',
      JSON.stringify([signedSwapTransactionBase64(7), 1]),
    ],
    ['an empty string', ''],
  ])('returns undefined for %s', (_label, txHex) => {
    expect(decodeStoredTransactions(txHex)).toBeUndefined()
  })
})
