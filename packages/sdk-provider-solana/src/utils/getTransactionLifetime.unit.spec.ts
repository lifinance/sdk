import { getTransactionCodec, type Transaction } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { base64ToUint8Array } from './base64ToUint8Array.js'
import { getTransactionLifetime } from './getTransactionLifetime.js'
import {
  createNonceMessageBytes,
  SWAP_TRANSACTION_BASE64,
  SWAP_TRANSACTION_BLOCKHASH,
} from './getTransactionLifetime.unit.mock.js'

describe('getTransactionLifetime', () => {
  it('returns the blockhash of a real v0 swap transaction with lookup tables', async () => {
    // Decoded exactly the way SolanaSignAndExecuteTask does it.
    const transaction = getTransactionCodec().decode(
      base64ToUint8Array(SWAP_TRANSACTION_BASE64)
    )

    await expect(getTransactionLifetime(transaction)).resolves.toEqual({
      kind: 'blockhash',
      blockhash: SWAP_TRANSACTION_BLOCKHASH,
    })
  })

  it('returns kind "nonce" for a durable-nonce transaction', async () => {
    const transaction = {
      messageBytes: createNonceMessageBytes(),
      signatures: {},
    } as unknown as Transaction

    await expect(getTransactionLifetime(transaction)).resolves.toEqual({
      kind: 'nonce',
    })
  })

  it('returns kind "unknown" instead of throwing on undecodable bytes', async () => {
    const transaction = {
      messageBytes: new Uint8Array([1, 2, 3, 4, 5]),
      signatures: {},
    } as unknown as Transaction

    await expect(getTransactionLifetime(transaction)).resolves.toEqual({
      kind: 'unknown',
    })
  })

  it('returns kind "unknown" instead of throwing on empty bytes', async () => {
    const transaction = {
      messageBytes: new Uint8Array(0),
      signatures: {},
    } as unknown as Transaction

    await expect(getTransactionLifetime(transaction)).resolves.toEqual({
      kind: 'unknown',
    })
  })
})
