import { ChainId } from '@lifi/types'
import { getENSAddress } from './getENSAddress.js'
import { getUNSAddress } from './uns/getUNSAddress.js'

export async function resolveEVMAddress(
  name: string
): Promise<string | undefined> {
  return (await getENSAddress(name)) || (await getUNSAddress(name, ChainId.ETH))
}
