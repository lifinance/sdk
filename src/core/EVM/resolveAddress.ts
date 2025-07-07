import type { ChainId } from '@lifi/types'
import { getENSAddress } from './getENSAddress.js'
import { getUNSAddress } from './uns/getUNSAddress.js'

export async function resolveAddress(
  name: string,
  chain?: ChainId
): Promise<string | undefined> {
  return (
    (await getENSAddress(name)) ||
    (chain ? await getUNSAddress(name, chain) : undefined)
  )
}
