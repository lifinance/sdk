import { type ChainId, ChainType, type SDKClient } from '@lifi/sdk'

export const getMulticallAddress = async (
  client: SDKClient,
  chainId: ChainId
): Promise<string | undefined> => {
  const chains = await client.getChains()
  return chains?.find(
    (chain) => chain.id === chainId && chain.chainType === ChainType.TVM
  )?.multicallAddress
}
