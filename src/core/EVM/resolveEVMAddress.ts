import type { ChainId, CoinKey } from '@lifi/types'
import { ChainType } from '@lifi/types'
import { resolveUNSAddress } from '../uns/resolveUNSAddress.js'
import { resolveENSAddress } from './resolveENSAddress.js'

export async function resolveEVMAddress(
  name: string,
  chainId?: ChainId,
  token?: CoinKey
): Promise<string | undefined> {
  return (
    (await resolveENSAddress(name)) ||
    (await resolveUNSAddress(name, ChainType.EVM, chainId, token))
  )
}
