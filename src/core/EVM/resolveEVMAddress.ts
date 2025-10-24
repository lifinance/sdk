import type { ChainId, CoinKey } from '@lifi/types'
import { ChainType } from '@lifi/types'
import type { SDKClient } from '../../types/core.js'
import { resolveENSAddress } from './resolveENSAddress.js'
import { resolveUNSAddress } from './uns/resolveUNSAddress.js'

export async function resolveEVMAddress(
  name: string,
  client: SDKClient,
  chainId?: ChainId,
  token?: CoinKey
): Promise<string | undefined> {
  return (
    (await resolveENSAddress(client, name)) ||
    (await resolveUNSAddress(client, name, ChainType.EVM, chainId, token))
  )
}
