import { ChainId, ChainType, type ExtendedChain } from '@lifi/types'
import { getChains } from '../services/api.js'
import type { RPCUrls, SDKBaseConfig } from './types.js'

export async function getRpcUrls(
  config: SDKBaseConfig,
  chainId: ChainId
): Promise<string[]> {
  const chains = await getChains(config, {
    chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
  })
  const metamaskRpcUrls = getMetamaskRPCUrls(chains)
  const rpcUrls = getMergedRPCUrls(config.rpcUrls, metamaskRpcUrls, [
    ChainId.SOL,
  ])
  const chainRpcUrls = rpcUrls[chainId]
  if (!chainRpcUrls?.length) {
    throw new Error(`RPC URL not found for chainId: ${chainId}`)
  }
  return chainRpcUrls
}

function getMergedRPCUrls(
  configRPCUrls: RPCUrls,
  rpcUrls: RPCUrls,
  skipChains?: ChainId[]
) {
  const newRPCUrls = { ...configRPCUrls }
  for (const rpcUrlsKey in rpcUrls) {
    const chainId = Number(rpcUrlsKey) as ChainId
    const urls = rpcUrls[chainId]
    if (!urls?.length) {
      continue
    }
    if (!newRPCUrls[chainId]?.length) {
      newRPCUrls[chainId] = Array.from(urls)
    } else if (!skipChains?.includes(chainId)) {
      const filteredUrls = urls.filter(
        (url) => !newRPCUrls[chainId]?.includes(url)
      )
      newRPCUrls[chainId].push(...filteredUrls)
    }
  }

  return newRPCUrls
}

function getMetamaskRPCUrls(chains: ExtendedChain[]) {
  return chains.reduce((rpcUrls, chain) => {
    if (chain.metamask?.rpcUrls?.length) {
      rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
    }
    return rpcUrls
  }, {} as RPCUrls)
}
