import { type ChainId, ChainType, getChains, type SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'

export const getMulticallAddress = async (
  client: SDKClient,
  chainId: ChainId
): Promise<Address | undefined> => {
  const chains = await getChains(client, {
    chainTypes: [ChainType.EVM],
  })
  return chains?.find((chain) => chain.id === chainId)
    ?.multicallAddress as Address
}
