import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import {
  parseSuiSignedTransaction,
  serializeSuiSignedTransaction,
} from './suiSignedTransaction.js'

// A fully specified transaction builds offline, without a client.
const transaction = new Transaction()
transaction.setSender(`0x${'1'.repeat(64)}`)
transaction.setGasPrice(1000)
transaction.setGasBudget(10_000_000)
transaction.setGasPayment([
  {
    objectId: `0x${'2'.repeat(64)}`,
    version: '1',
    digest: toBase58(new Uint8Array(32).fill(3)),
  },
])
const BYTES = await transaction.build()
const SIGNATURE = 'AFakeSerializedSignature'
// 26 characters with padding: `atob` rejects it.
const NOT_BASE64_SIGNATURE = 'AFakeSerializedSignature=='

describe('serializeSuiSignedTransaction', () => {
  it('stores JSON with base64 bytes and the signature that reads back to the same bytes', () => {
    const txHex = serializeSuiSignedTransaction(BYTES, SIGNATURE)

    expect(txHex).toBe(
      JSON.stringify({ bytes: toBase64(BYTES), signature: SIGNATURE })
    )
    expect(parseSuiSignedTransaction(txHex as string)).toEqual({
      bytes: BYTES,
      signature: SIGNATURE,
      digest: TransactionDataBuilder.getDigestFromBytes(BYTES),
    })
  })

  it('stores nothing without a signature', () => {
    expect(serializeSuiSignedTransaction(BYTES, '')).toBeUndefined()
  })

  it('stores nothing for a signature that is not base64', () => {
    expect(
      serializeSuiSignedTransaction(BYTES, NOT_BASE64_SIGNATURE)
    ).toBeUndefined()
  })

  it('stores nothing for bytes that are not a TransactionData', () => {
    expect(
      serializeSuiSignedTransaction(new Uint8Array([1, 2, 3]), SIGNATURE)
    ).toBeUndefined()
  })
})

describe('parseSuiSignedTransaction', () => {
  it.each([
    ['not JSON', '{"bytes":'],
    ['JSON null', 'null'],
    [
      'bytes that are not base64',
      JSON.stringify({ bytes: '***', signature: SIGNATURE }),
    ],
    ['empty bytes', JSON.stringify({ bytes: '', signature: SIGNATURE })],
    ['a missing signature', JSON.stringify({ bytes: toBase64(BYTES) })],
    [
      'a signature that is not base64',
      JSON.stringify({
        bytes: toBase64(BYTES),
        signature: NOT_BASE64_SIGNATURE,
      }),
    ],
    [
      'a signature that decodes to no bytes',
      JSON.stringify({ bytes: toBase64(BYTES), signature: ' ' }),
    ],
  ])('rejects %s', (_label, txHex) => {
    expect(parseSuiSignedTransaction(txHex)).toBeUndefined()
  })
})
