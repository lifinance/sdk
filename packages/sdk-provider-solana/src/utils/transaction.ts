import { fromVersionedTransaction } from '@solana/compat'
import { getTransactionCodec, type Transaction } from '@solana/kit'
import { VersionedTransaction } from '@solana/web3.js'

export function toVersionedTransaction(transaction: Transaction) {
  const transactionCodec = getTransactionCodec()
  const transactionBytes = transactionCodec.encode(transaction)

  return VersionedTransaction.deserialize(new Uint8Array(transactionBytes))
}

export { fromVersionedTransaction }
