import { ChainId, ChainType, type ExtendedChain } from '@lifi/types'
import { _getChains } from '../actions/getChains.js'
import { getRpcUrlsFromChains } from '../core/utils.js'
import type { RPCUrls, RPCUrlsConfig, SDKBaseConfig } from '../types/core.js'

// 6 hours in milliseconds
const chainsRefreshInterval = 1000 * 60 * 60 * 6

export interface ClientStorage {
  readonly needReset: boolean
  setChains(chains: ExtendedChain[]): void
  getChains(): Promise<ExtendedChain[]>
  getRpcUrls(): Promise<RPCUrls>
}

/** The read URLs of every configured chain. Write URLs never serve reads. */
const getReadRpcUrls = (rpcUrls: RPCUrlsConfig): RPCUrls => {
  const readRpcUrls: RPCUrls = {}
  for (const key in rpcUrls) {
    const chainId = Number(key) as ChainId
    const entry = rpcUrls[chainId]
    const urls = Array.isArray(entry) ? entry : entry?.read
    if (urls) {
      readRpcUrls[chainId] = urls
    }
  }
  return readRpcUrls
}

export const getClientStorage = (config: SDKBaseConfig): ClientStorage => {
  let _chains = [] as ExtendedChain[]
  let _rpcUrls = getReadRpcUrls(config.rpcUrls)
  let _chainsUpdatedAt: number | undefined

  const updateRpcUrls = () => {
    _rpcUrls = getRpcUrlsFromChains(getReadRpcUrls(config.rpcUrls), _chains, [
      ChainId.SOL,
    ])
  }

  return {
    get needReset() {
      return (
        !_chainsUpdatedAt ||
        Date.now() - _chainsUpdatedAt >= chainsRefreshInterval
      )
    },
    setChains(chains: ExtendedChain[]) {
      _chains = chains
      _chainsUpdatedAt = Date.now()
      updateRpcUrls()
    },
    async getChains() {
      // When preloadChains is false, SDK does not auto-fetch chains
      // External consumer is responsible for calling setChains
      if (!config.preloadChains) {
        return _chains
      }

      if (this.needReset || !_chains.length) {
        _chains = await _getChains(config, {
          chainTypes: [
            ChainType.EVM,
            ChainType.SVM,
            ChainType.UTXO,
            ChainType.MVM,
            ChainType.TVM,
            ChainType.STL,
          ],
        })
        _chainsUpdatedAt = Date.now()
        updateRpcUrls()
      }
      return _chains
    },
    async getRpcUrls() {
      await this.getChains() // _rpcUrls is updated when needed
      return _rpcUrls
    },
  }
}
