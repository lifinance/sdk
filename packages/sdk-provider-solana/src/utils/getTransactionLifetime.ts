import {
  type Blockhash,
  getCompiledTransactionMessageDecoder,
  getTransactionLifetimeConstraintFromCompiledTransactionMessage,
  type Transaction,
} from '@solana/kit'

export type TransactionLifetime =
  | { kind: 'blockhash'; blockhash: Blockhash }
  | { kind: 'nonce' }
  | { kind: 'unknown' }

const decoder = getCompiledTransactionMessageDecoder()

/**
 * Decoding yields `{ messageBytes, signatures }` alone, so the lifetime is
 * recovered from the compiled message.
 *
 * Never throws: anything undecodable yields `unknown`, degrading confirmation
 * to the wall-clock ceiling rather than aborting the send.
 */
export async function getTransactionLifetime(
  transaction: Transaction
): Promise<TransactionLifetime> {
  try {
    const compiledMessage = decoder.decode(transaction.messageBytes)
    const constraint =
      await getTransactionLifetimeConstraintFromCompiledTransactionMessage(
        compiledMessage
      )
    if ('blockhash' in constraint) {
      return { kind: 'blockhash', blockhash: constraint.blockhash }
    }
    return { kind: 'nonce' }
  } catch (_) {
    return { kind: 'unknown' }
  }
}
