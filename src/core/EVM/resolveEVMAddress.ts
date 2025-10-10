import type { ChainId, CoinKey } from '@lifi/types'
import { ChainType } from '@lifi/types'
import type { SDKProviderConfig } from '../types.js'
import { resolveENSAddress } from './resolveENSAddress.js'
import { resolveUNSAddress } from './uns/resolveUNSAddress.js'

export async function resolveEVMAddress(
  name: string,
  config: SDKProviderConfig,
  chainId?: ChainId,
  token?: CoinKey
): Promise<string | undefined> {
  return (
    (await resolveENSAddress(config, name)) ||
    (await resolveUNSAddress(config, name, ChainType.EVM, chainId, token))
  )
}
