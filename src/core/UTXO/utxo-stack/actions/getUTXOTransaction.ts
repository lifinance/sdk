import { type Account, type Chain, type Client, type Transport } from 'viem'
import type { UTXOSchema } from '../transports/utxo/types.js'
import type { UTXOTransaction } from '../types/transaction.js'

export type GetUTXOTransactionParameters = {
  /** The Id of the transaction */
  txId: string
  /** The block in which to look for the transaction */
  blockHash?: string
}

export type GetUTXOTransactionReturnType = UTXOTransaction

export async function getUTXOTransaction<
  C extends Chain | undefined,
  A extends Account | undefined = Account | undefined,
>(
  client: Client<Transport, C, A, UTXOSchema>,
  { txId, blockHash }: GetUTXOTransactionParameters
): Promise<GetUTXOTransactionReturnType> {
  const params: [string, boolean, string?] = [txId, true]
  if (blockHash) {
    params.push(blockHash)
  }
  const data = await client.request({
    method: 'getrawtransaction',
    params: params,
  })
  return data
}
