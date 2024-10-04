import type { Account, Chain, Client, Transport } from 'viem'
import type { UTXOSchema } from '../transports/utxo/types.js'

export type GetBlockCountReturnType = number

export async function getBlockCount<
  C extends Chain | undefined,
  A extends Account | undefined = Account | undefined,
>(
  client: Client<Transport, C, A, UTXOSchema>
): Promise<GetBlockCountReturnType> {
  const data = await client.request(
    {
      method: 'getblockcount',
      params: [],
    },
    { dedupe: true }
  )
  return data
}
