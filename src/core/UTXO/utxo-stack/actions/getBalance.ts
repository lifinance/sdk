import type { Account, Chain, Client, Transport } from 'viem'
import type { UTXOAPISchema } from '../transports/utxo/types.js'

export type GetBalanceParameters = {
  /** The address of the account. */
  address: string
}

export type GetBalanceReturnType = bigint

export async function getBalance<
  C extends Chain | undefined,
  A extends Account | undefined = Account | undefined,
>(
  client: Client<Transport, C, A, UTXOAPISchema>,
  params: GetBalanceParameters
): Promise<GetBalanceReturnType> {
  const data = await client.request(
    {
      method: 'getBalance',
      params,
    },
    { dedupe: true }
  )
  return data
}
