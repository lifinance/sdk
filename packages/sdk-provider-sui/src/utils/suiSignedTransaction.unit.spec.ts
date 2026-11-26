import type { ClientWithCoreApi } from '@mysten/sui/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { isValidTransactionSignature } from '@mysten/sui/verify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseSuiSignedTransaction,
  serializeSuiSignedTransaction,
  type SuiSignedTransaction,
  verifySuiSignedTransaction,
} from './suiSignedTransaction.js'
import {
  buildTransactionBytes,
  BYTES,
  SIGNATURE,
} from './suiSignedTransaction.unit.mock.js'

// A full node checks a plain key's signature the same way as this local
// check. It also accepts zkLogin and address-alias signatures, which the
// tests that need them stub.
const verifySignature = vi.fn(
  async (options: {
    transaction: Uint8Array
    signature: string
    address: string
    signal?: AbortSignal
  }) => ({
    valid: await isValidTransactionSignature(
      options.transaction,
      options.signature,
      { address: options.address, offline: true }
    ),
  })
)
const node = { core: { verifySignature } } as unknown as ClientWithCoreApi

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
  beforeEach(() => {
    verifySignature.mockClear()
  })

  it('accepts the signature of the sender over the stored bytes, checked on the node', async () => {
    const transaction = readBack(SENDER_BYTES, SENDER_SIGNATURE)

    expect(await verifySuiSignedTransaction(transaction, node)).toBe(true)
    expect(verifySignature).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: SENDER_BYTES,
        signature: SENDER_SIGNATURE,
        address: SENDER.toSuiAddress(),
      })
    )
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

    expect(await verifySuiSignedTransaction(transaction, node)).toBe(false)
  })

  it('rejects a valid signature from a key that is not the sender', async () => {
    const other = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
    const { signature } = await other.signTransaction(SENDER_BYTES)
    const transaction = readBack(SENDER_BYTES, signature)

    expect(await verifySuiSignedTransaction(transaction, node)).toBe(false)
  })

  it('accepts a signature that only a node can verify, such as one from an address alias of the sender', async () => {
    const alias = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
    const { signature } = await alias.signTransaction(SENDER_BYTES)
    const transaction = readBack(SENDER_BYTES, signature)
    // A local check rejects it: the key is not the sender's own key.
    expect(
      await isValidTransactionSignature(SENDER_BYTES, signature, {
        address: SENDER.toSuiAddress(),
        offline: true,
      })
    ).toBe(false)
    verifySignature.mockResolvedValueOnce({ valid: true })

    expect(await verifySuiSignedTransaction(transaction, node)).toBe(true)
  })

  it('rejects a malformed signature', async () => {
    const transaction = readBack(SENDER_BYTES, SIGNATURE)

    expect(await verifySuiSignedTransaction(transaction, node)).toBe(false)
  })

  it('fails, and does not resolve false, when the node cannot verify', async () => {
    const error = new Error('The node cannot check address aliases')
    verifySignature.mockRejectedValueOnce(error)
    const transaction = readBack(SENDER_BYTES, SENDER_SIGNATURE)

    await expect(verifySuiSignedTransaction(transaction, node)).rejects.toBe(
      error
    )
  })

  it('passes the abort signal to the node', async () => {
    const controller = new AbortController()
    const transaction = readBack(SENDER_BYTES, SENDER_SIGNATURE)

    await verifySuiSignedTransaction(transaction, node, controller.signal)

    expect(verifySignature).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    )
  })
})
