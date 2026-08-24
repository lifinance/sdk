import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import {
  getSignatureFromTransaction,
  type Signature,
  type Transaction,
} from '@solana/kit'

/**
 * Reads a signed transaction's signature, restating a `@solana/kit` failure as
 * a `TransactionError`.
 *
 * Both wait tasks derive the signature before they submit, so this call is on
 * the execution path. `getSignatureFromTransaction` throws a bare
 * `SolanaError` when the fee payer's slot is null - a wallet that returned a
 * partially signed transaction, or a bundle whose first entry is signed by
 * someone else. Integrator error branching switches on `LiFiErrorCode`, so an
 * unwrapped throw lands in the unknown bucket.
 */
export function readSignature(transaction: Transaction): Signature {
  try {
    return getSignatureFromTransaction(transaction)
  } catch (error) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction. The signed transaction carries no fee payer signature.',
      error as Error
    )
  }
}
