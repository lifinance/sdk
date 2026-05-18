import {
  type Blockhash,
  getCompiledTransactionMessageDecoder,
  isTransactionWithDurableNonceLifetime,
  type Transaction,
} from '@solana/kit'

const decoder = getCompiledTransactionMessageDecoder()

export function extractBlockhash(
  signedTransaction: Transaction
): Blockhash | null {
  if (isTransactionWithDurableNonceLifetime(signedTransaction)) {
    return null
  }
  const compiledMessage = decoder.decode(signedTransaction.messageBytes)
  return compiledMessage.lifetimeToken as Blockhash
}
