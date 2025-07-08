import { ChainId } from '@lifi/types'
import { getUNSAddress } from '../EVM/uns/getUNSAddress.js'
import { getSNSAddress } from './getSNSAddress.js'

export async function resolveSolanaAddress(
  name: string
): Promise<string | undefined> {
  return (await getSNSAddress(name)) || (await getUNSAddress(name, ChainId.SOL))
}
