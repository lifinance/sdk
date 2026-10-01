import type { SignedTransaction } from '@tronweb3/tronwallet-abstract-adapter'
import { describe, expect, it } from 'vitest'
import {
  parseTronSignedTransaction,
  serializeTronSignedTransaction,
} from './tronSignedTransaction.js'

const TX_ID = 'c3e7a4c5c0b8d2f1e9a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809102'

const SIGNED_TRANSACTION = {
  visible: false,
  txID: TX_ID,
  raw_data: {
    contract: [],
    ref_block_bytes: '1a2b',
    ref_block_hash: '0011223344556677',
    expiration: 1_790_000_060_000,
    timestamp: 1_790_000_000_000,
  },
  raw_data_hex: '0a021a2b',
  signature: ['c0ffee'],
} as unknown as SignedTransaction

describe('serializeTronSignedTransaction', () => {
  it('stores JSON that reads back to the same transaction', () => {
    const txHex = serializeTronSignedTransaction(SIGNED_TRANSACTION)

    expect(txHex).toBe(JSON.stringify(SIGNED_TRANSACTION))
    expect(parseTronSignedTransaction(txHex as string)).toEqual(
      SIGNED_TRANSACTION
    )
  })

  it.each([
    ['no txID', { ...SIGNED_TRANSACTION, txID: '' }],
    ['a txID that is not 32 bytes', { ...SIGNED_TRANSACTION, txID: 'abc' }],
    ['no signature', { ...SIGNED_TRANSACTION, signature: [] }],
    [
      'no expiration',
      {
        ...SIGNED_TRANSACTION,
        raw_data: { ...SIGNED_TRANSACTION.raw_data, expiration: undefined },
      },
    ],
  ])('stores nothing for a transaction with %s', (_label, transaction) => {
    expect(
      serializeTronSignedTransaction(
        transaction as unknown as SignedTransaction
      )
    ).toBeUndefined()
  })
})

describe('parseTronSignedTransaction', () => {
  it('accepts a 0x-prefixed txID', () => {
    const txHex = JSON.stringify({ ...SIGNED_TRANSACTION, txID: `0x${TX_ID}` })

    expect(parseTronSignedTransaction(txHex)?.txID).toBe(`0x${TX_ID}`)
  })

  it.each([
    ['not JSON', '{"txID":'],
    ['JSON null', 'null'],
    ['a JSON string', '"c3e7"'],
    ['an object without the transaction fields', '{"foo":1}'],
  ])('rejects %s', (_label, txHex) => {
    expect(parseTronSignedTransaction(txHex)).toBeUndefined()
  })
})
