import type { Account, Chain, Client, Transport } from 'viem'
import type {
  SignPsbtParameters,
  SignPsbtReturnType,
  UTXOWalletSchema,
} from '../clients/types.js'

export async function signPsbt<
  C extends Chain | undefined,
  A extends Account | undefined = Account | undefined,
>(
  client: Client<Transport, C, A, UTXOWalletSchema>,
  params: SignPsbtParameters
): Promise<SignPsbtReturnType> {
  const data = await client.request(
    {
      method: 'signPsbt',
      params: params,
    },
    { dedupe: true }
  )
  return data
}
