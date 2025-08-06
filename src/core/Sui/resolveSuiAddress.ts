import { ChainType } from '@lifi/types'
import { resolveUNSAddress } from '../uns/resolveUNSAddress.js'
import { getSuiNSAddress } from './getSuiNSAddress.js'

export async function resolveSuiAddress(
  name: string
): Promise<string | undefined> {
  return (
    (await getSuiNSAddress(name)) ||
    (await resolveUNSAddress(name, ChainType.MVM))
  )
}
