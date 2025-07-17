import { ChainType } from '@lifi/types'
import { resolveUNSAddress } from '../EVM/uns/resolveUNSAddress.js'
import { getSNSAddress } from './getSNSAddress.js'

export async function resolveSolanaAddress(
  name: string
): Promise<string | undefined> {
  return (
    (await getSNSAddress(name)) ||
    (await resolveUNSAddress(name, ChainType.SVM))
  )
}
