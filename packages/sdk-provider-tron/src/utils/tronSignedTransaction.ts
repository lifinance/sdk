import type { SignedTransaction } from '@tronweb3/tronwallet-abstract-adapter'
import { stripHexPrefix } from './stripHexPrefix.js'

// A txID is the SHA-256 of `raw_data_hex`: 32 bytes, 64 hex characters.
const TX_ID_PATTERN = /^[0-9a-f]{64}$/i

/**
 * Reads a signed transaction back from `ExecutionAction.txHex`.
 *
 * Returns `undefined` unless the value carries everything a resume needs: the
 * `txID` to look the transaction up, a signature to resend it and
 * `raw_data.expiration` to tell when it can no longer land.
 */
export function parseTronSignedTransaction(
  txHex: string
): SignedTransaction | undefined {
  let value: unknown
  try {
    value = JSON.parse(txHex)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const { txID, signature, raw_data } = value as Partial<SignedTransaction>
  if (typeof txID !== 'string' || !TX_ID_PATTERN.test(stripHexPrefix(txID))) {
    return undefined
  }
  if (!Array.isArray(signature) || !signature.length) {
    return undefined
  }
  if (
    typeof raw_data?.expiration !== 'number' ||
    !Number.isFinite(raw_data.expiration)
  ) {
    return undefined
  }
  return value as SignedTransaction
}

/**
 * Serializes a signed transaction for `ExecutionAction.txHex`.
 *
 * Returns `undefined` when the result would not read back with
 * `parseTronSignedTransaction`, so a stored value is always usable on resume.
 */
export function serializeTronSignedTransaction(
  signedTransaction: SignedTransaction
): string | undefined {
  const txHex = JSON.stringify(signedTransaction) as string | undefined
  return txHex && parseTronSignedTransaction(txHex) ? txHex : undefined
}
