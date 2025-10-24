import {
  type ChainId,
  ChainType,
  type CoinKey,
  type SDKClient,
} from '@lifi/sdk'
import { resolveENSAddress } from './resolveENSAddress.js'
import { resolveUNSAddress } from './uns/resolveUNSAddress.js'

export async function resolveEthereumAddress(
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
