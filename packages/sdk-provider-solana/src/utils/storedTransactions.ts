import {
  getBase64Decoder,
  getSignatureFromTransaction,
  getTransactionCodec,
  type Signature,
  type Transaction,
} from '@solana/kit'
import { base64ToUint8Array } from './base64ToUint8Array.js'

/** Signed transactions decoded from `action.txHex`. */
export type StoredTransactions = {
  transactions: Transaction[]
  /** A Jito bundle: submitted with `sendBundle`, never one by one. */
  isBundle: boolean
  /** The first transaction's signature: the action's `txHash` once sent. */
  signature: Signature
}

/**
 * Serializes signed wire transactions for `action.txHex`: the base64 wire
 * transaction for a single one, a JSON array of them for a bundle.
 *
 * The array stays for a one-element bundle too: the leading `[` is the only
 * record of `isBundleExecution` a resume gets.
 */
export function encodeStoredTransactions(
  wireTransactions: readonly Uint8Array[],
  isBundle: boolean
): string {
  const base64 = getBase64Decoder()
  const encoded = wireTransactions.map((bytes) => base64.decode(bytes))
  return isBundle ? JSON.stringify(encoded) : encoded[0]
}

/** A leading `[` marks a bundle; base64 never starts with one. */
export function isStoredBundle(txHex: string): boolean {
  return txHex.startsWith('[')
}

/**
 * Decodes `action.txHex` back into signed transactions.
 *
 * Returns `undefined` for anything a resume cannot send: a value that is not
 * base64 or JSON, an empty bundle, bytes that do not decode, or a
 * transaction without its fee payer signature. The sign task stores only
 * values that pass these checks, so `undefined` means the stored value was
 * damaged after it was written.
 */
export function decodeStoredTransactions(
  txHex: string
): StoredTransactions | undefined {
  try {
    const isBundle = isStoredBundle(txHex)
    const encoded: unknown = isBundle ? JSON.parse(txHex) : [txHex]
    if (
      !Array.isArray(encoded) ||
      encoded.length === 0 ||
      !encoded.every((entry) => typeof entry === 'string')
    ) {
      return undefined
    }
    const codec = getTransactionCodec()
    const transactions = encoded.map((entry: string) =>
      codec.decode(base64ToUint8Array(entry))
    )
    // Every entry must carry its fee payer signature, as the sign task
    // checked before it stored them. `getSignatureFromTransaction` throws
    // when one does not.
    const signatures = transactions.map((transaction) =>
      getSignatureFromTransaction(transaction)
    )
    return { transactions, isBundle, signature: signatures[0] }
  } catch (_) {
    return undefined
  }
}
