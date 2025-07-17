import { ChainType } from '@lifi/types'
import { resolveENSAddress } from './resolveENSAddress.js'
import { resolveUNSAddress } from './uns/resolveUNSAddress.js'

export async function resolveEVMAddress(
  name: string
): Promise<string | undefined> {
  return (
    (await resolveENSAddress(name)) ||
    (await resolveUNSAddress(name, ChainType.EVM))
  )
}
