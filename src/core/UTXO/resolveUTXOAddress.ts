import { ChainType } from '@lifi/types'
import { resolveUNSAddress } from '../EVM/uns/resolveUNSAddress.js'

export async function resolveUTXOAddress(
  name: string
): Promise<string | undefined> {
  return (await resolveUNSAddress(name, ChainType.UTXO)) || name
}
