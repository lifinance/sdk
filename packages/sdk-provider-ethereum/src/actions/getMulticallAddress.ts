import { type ChainId, ChainType, type SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'

export const getMulticallAddress = async (
  client: SDKClient,
  chainId: ChainId
): Promise<Address | undefined> => {
  const chains = await client.getChains()
  return chains?.find(
    (chain) => chain.id === chainId && chain.chainType === ChainType.EVM
  )?.multicallAddress as Address
}
