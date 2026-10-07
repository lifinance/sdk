import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'

/**
 * Builds the bytes of a fully specified transaction. With the sender, the gas
 * price, the gas budget and the gas payment set, `build()` needs no client, so
 * a `build({ client })` makes no client call and returns the same bytes.
 */
export function buildTransactionBytes(sender: string): Promise<Uint8Array> {
  const transaction = new Transaction()
  transaction.setSender(sender)
  transaction.setGasPrice(1000)
  transaction.setGasBudget(10_000_000)
  transaction.setGasPayment([
    {
      objectId: `0x${'2'.repeat(64)}`,
      version: '1',
      digest: toBase58(new Uint8Array(32).fill(3)),
    },
  ])
  return transaction.build()
}

export const SENDER_ADDRESS: string = `0x${'1'.repeat(64)}`

/** Valid base64, so the `txHex` codec accepts it, but not a real signature. */
export const SIGNATURE: string = 'AFakeSerializedSignature'

export const BYTES: Uint8Array = await buildTransactionBytes(SENDER_ADDRESS)

export const DIGEST: string = TransactionDataBuilder.getDigestFromBytes(BYTES)

/** The `ExecutionAction.txHex` value for `BYTES` signed with `SIGNATURE`. */
export const TX_HEX: string = JSON.stringify({
  bytes: toBase64(BYTES),
  signature: SIGNATURE,
})
