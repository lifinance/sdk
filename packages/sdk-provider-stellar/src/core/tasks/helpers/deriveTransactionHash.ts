import { type Transaction, TransactionBuilder } from '@stellar/stellar-sdk'

/**
 * Derives the canonical transaction hash from a signed base64 envelope.
 *
 * The hash is a function of the envelope and the network passphrase, so it is
 * knowable before submission — which is what lets a signing task persist the
 * hash first and resume by polling instead of re-signing.
 */
export const deriveTransactionHash = (
  signedTxXdr: string,
  networkPassphrase: string
): string => {
  const transaction = TransactionBuilder.fromXdr(
    signedTxXdr,
    networkPassphrase
  ) as Transaction
  return Array.from(transaction.hash(), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
