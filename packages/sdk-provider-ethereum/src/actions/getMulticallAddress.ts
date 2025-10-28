import {
  type ChainId,
  ChainType,
  getChainsFromConfig,
  type SDKBaseConfig,
} from '@lifi/sdk'
import type { Address } from 'viem'

export const getMulticallAddress = async (
  config: SDKBaseConfig,
  chainId: ChainId
): Promise<Address | undefined> => {
  const chains = await getChainsFromConfig(config, {
    chainTypes: [ChainType.EVM],
  })
  return chains?.find((chain) => chain.id === chainId)
    ?.multicallAddress as Address
}
