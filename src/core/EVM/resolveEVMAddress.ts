import { ChainType } from '@lifi/types'
import { resolveUNSAddress } from '../uns/resolveUNSAddress.js'
import { resolveENSAddress } from './resolveENSAddress.js'

export async function resolveEVMAddress(
  name: string
): Promise<string | undefined> {
  return (
    (await resolveENSAddress(name)) ||
    (await resolveUNSAddress(name, ChainType.EVM))
  )
}
