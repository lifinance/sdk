import { ChainId } from '@lifi/types'
import { resolveUNSAddress } from '../uns/resolveUNSAddress.js'

export async function resolveUTXOAddress(
  name: string
): Promise<string | undefined> {
  return (await resolveUNSAddress(name, ChainId.BTC)) || name
}
