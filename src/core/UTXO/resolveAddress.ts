import { ChainId } from '@lifi/types'
import { getUNSAddress } from '../EVM/uns/getUNSAddress.js'

export async function resolveAddress(
  name: string
): Promise<string | undefined> {
  return (await getUNSAddress(name, ChainId.BTC)) || name
}
