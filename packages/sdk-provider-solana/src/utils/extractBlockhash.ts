import {
  type Blockhash,
  getCompiledTransactionMessageDecoder,
  getTransactionLifetimeConstraintFromCompiledTransactionMessage,
  type Transaction,
} from '@solana/kit'

const decoder = getCompiledTransactionMessageDecoder()

export async function extractBlockhash(
  signedTransaction: Transaction
): Promise<Blockhash | null> {
  const compiledMessage = decoder.decode(signedTransaction.messageBytes)
  const constraint =
    await getTransactionLifetimeConstraintFromCompiledTransactionMessage(
      compiledMessage
    )
  if ('blockhash' in constraint) {
    return constraint.blockhash
  }
  return null
}
