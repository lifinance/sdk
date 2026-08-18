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
 * Reads the lifetime a signed transaction actually carries.
 *
 * `getTransactionCodec().decode()` produces `{ messageBytes, signatures }` and
 * nothing else, so the lifetime has to be recovered from the compiled message.
 *
 * This never throws. An unsupported message version, a nonce account resolved
 * through an address lookup table, or undecodable bytes all yield `unknown`,
 * which degrades confirmation to the wall-clock ceiling. Aborting a send
 * because a decode failed would be strictly worse than that.
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
