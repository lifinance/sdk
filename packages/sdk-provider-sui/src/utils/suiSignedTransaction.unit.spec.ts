import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { isValidTransactionSignature } from '@mysten/sui/verify'
import { describe, expect, it, vi } from 'vitest'
import {
  parseSuiSignedTransaction,
  type SuiSignedTransaction,
  serializeSuiSignedTransaction,
  verifySuiSignedTransaction,
} from './suiSignedTransaction.js'

vi.mock('@mysten/sui/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mysten/sui/verify')>()
  return {
    ...actual,
    isValidTransactionSignature: vi.fn(actual.isValidTransactionSignature),
  }
})

// A fully specified transaction builds offline, without a client.
function buildTransactionBytes(sender: string): Promise<Uint8Array> {
  const transaction = new Transaction()
  transaction.setSender(sender)
  transaction.setGasPrice(1000)
  transaction.setGasBudget(10_000_000)
  transaction.setGasPayment([
    {
      objectId: `0x${'2'.repeat(64)}`,
      version: '1',
      digest: toBase58(new Uint8Array(32).fill(3)),
    },
  ])
  return transaction.build()
}

const BYTES = await buildTransactionBytes(`0x${'1'.repeat(64)}`)
const SIGNATURE = 'AFakeSerializedSignature'
// 26 characters is not a multiple of 4, so `atob` rejects the `=`.
const NOT_BASE64_SIGNATURE = 'AFakeSerializedSignature=='

const SENDER = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
const SENDER_BYTES = await buildTransactionBytes(SENDER.toSuiAddress())
const { signature: SENDER_SIGNATURE } =
  await SENDER.signTransaction(SENDER_BYTES)

/** Stores and reads back a signed transaction, as a resume does. */
function readBack(bytes: Uint8Array, signature: string): SuiSignedTransaction {
  const txHex = serializeSuiSignedTransaction(bytes, signature)
  const transaction = txHex ? parseSuiSignedTransaction(txHex) : undefined
  expect(transaction).toBeDefined()
  return transaction as SuiSignedTransaction
}

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

  it('stores a padded signature of a real length that reads back unchanged', () => {
    // 97 bytes is the length of an Ed25519 serialized signature.
    const signature = toBase64(new Uint8Array(97).fill(1))
    expect(signature).toMatch(/==$/)

    const txHex = serializeSuiSignedTransaction(BYTES, signature)

    expect(txHex).toBe(JSON.stringify({ bytes: toBase64(BYTES), signature }))
    expect(parseSuiSignedTransaction(txHex as string)?.signature).toBe(
      signature
    )
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
    [
      'bytes with data after the TransactionData',
      JSON.stringify({
        bytes: toBase64(new Uint8Array([...BYTES, 9, 9, 9])),
        signature: SIGNATURE,
      }),
    ],
    ['a missing signature', JSON.stringify({ bytes: toBase64(BYTES) })],
    [
      'a signature that is not a string',
      JSON.stringify({ bytes: toBase64(BYTES), signature: 1234 }),
    ],
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

describe('verifySuiSignedTransaction', () => {
  it('accepts the signature of the sender over the stored bytes', async () => {
    const transaction = readBack(SENDER_BYTES, SENDER_SIGNATURE)

    expect(await verifySuiSignedTransaction(transaction)).toBe(true)
  })

  it('rejects stored bytes with one flipped byte that still parse', async () => {
    const tampered = Uint8Array.from(SENDER_BYTES)
    // The last 9 bytes are the gas budget (u64, little-endian) and the
    // expiration, so this changes the budget only.
    tampered[tampered.length - 9] ^= 1
    expect(TransactionDataBuilder.fromBytes(tampered).gasData.budget).toBe(
      '10000001'
    )
    const transaction = readBack(tampered, SENDER_SIGNATURE)

    expect(await verifySuiSignedTransaction(transaction)).toBe(false)
  })

  it('rejects a valid signature from a key that is not the sender', async () => {
    const other = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
    const { signature } = await other.signTransaction(SENDER_BYTES)
    const transaction = readBack(SENDER_BYTES, signature)

    expect(await verifySuiSignedTransaction(transaction)).toBe(false)
  })

  it('rejects a malformed signature', async () => {
    const transaction = readBack(SENDER_BYTES, SIGNATURE)

    expect(await verifySuiSignedTransaction(transaction)).toBe(false)
  })

  it('fails, and does not resolve false, when the verification cannot run', async () => {
    const error = new Error('A Sui Client is required')
    vi.mocked(isValidTransactionSignature).mockRejectedValueOnce(error)
    const transaction = readBack(SENDER_BYTES, SENDER_SIGNATURE)

    await expect(verifySuiSignedTransaction(transaction)).rejects.toBe(error)
  })
})
