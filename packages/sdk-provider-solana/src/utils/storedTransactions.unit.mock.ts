import {
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  type Transaction,
} from '@solana/kit'
import { base64ToUint8Array } from './base64ToUint8Array.js'
import {
  createNonceMessageBytes,
  SWAP_TRANSACTION_BASE64,
} from './getTransactionLifetime.unit.mock.js'

/** Base58 of a 64 byte signature filled with `fill`. */
export function signatureFilledWith(fill: number): string {
  return getBase58Decoder().decode(new Uint8Array(64).fill(fill))
}

/**
 * The captured swap transaction, signed. Its fee payer slot is all zeros,
 * which `@solana/kit` decodes as a missing signature; filling it gives a
 * transaction whose signature can be read, with the real message and its
 * blockhash lifetime untouched.
 */
export function signedSwapTransactionBase64(fill: number): string {
  const bytes = base64ToUint8Array(SWAP_TRANSACTION_BASE64)
  // Byte 0 is the signature count (1); the fee payer signature follows it.
  bytes.fill(fill, 1, 65)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/** A signed durable-nonce transaction: `getTransactionLifetime` reads
 * `{ kind: 'nonce' }` from it. */
export function signedNonceTransactionBase64(fill: number): string {
  // The encoder reads only the signature values; the decoder takes the
  // signer addresses from the message, so the key here is arbitrary.
  return getBase64EncodedWireTransaction({
    messageBytes: createNonceMessageBytes(),
    signatures: { signer: new Uint8Array(64).fill(fill) },
  } as unknown as Transaction)
}
