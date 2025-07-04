import { getENSAddress } from './getENSAddress.js'
import { getUNSAddress } from './getUNSAddress.js'

export async function resolveAddress(
  name: string
): Promise<string | undefined> {
  return (await getENSAddress(name)) || (await getUNSAddress(name))
}
