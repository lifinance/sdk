import { type Account, type Chain, type Client, type Transport } from 'viem'
import type { UTXOSchema } from '../transports/utxo/types.js'

export type SendUTXOTransactionParameters = {
  /** The hex string of the raw transaction */
  hex: string
  /** Rejects transactions whose fee rate is higher than the specified value, expressed in BTC/kB. Set to 0 to accept any fee rate. Default = 0.10 */
  maxFeeRate?: number
}

export type SendUTXOTransactionReturnType = string

export async function sendUTXOTransaction<
  C extends Chain | undefined,
  A extends Account | undefined = Account | undefined,
>(
  client: Client<Transport, C, A, UTXOSchema>,
  { hex, maxFeeRate }: SendUTXOTransactionParameters
): Promise<SendUTXOTransactionReturnType> {
  const params: [string, number?] = [hex]
  if (maxFeeRate) {
    params.push(maxFeeRate)
  }
  const data = await client.request({
    method: 'sendrawtransaction',
    params: params,
  })
  return data
}
