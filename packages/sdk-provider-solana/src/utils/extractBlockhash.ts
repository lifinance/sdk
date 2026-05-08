import {
  type Blockhash,
  getCompiledTransactionMessageDecoder,
  isTransactionWithDurableNonceLifetime,
  type Transaction,
} from '@solana/kit'

const decoder = getCompiledTransactionMessageDecoder()

export function extractBlockhash(signedTransaction: Transaction): Blockhash {
  if (isTransactionWithDurableNonceLifetime(signedTransaction)) {
    throw new Error(
      'Durable nonce transactions are not supported by sendAndConfirmTransaction'
    )
  }
  const compiledMessage = decoder.decode(signedTransaction.messageBytes)
  return compiledMessage.lifetimeToken as Blockhash
}
