import { ChainId, ChainType, type ExtendedChain } from '@lifi/types'
import { _getChains } from '../actions/getChains.js'
import { getRpcUrlsFromChains } from '../core/utils.js'
import type { RPCUrls, SDKBaseConfig } from '../types/core.js'

// 6 hours in milliseconds
const chainsRefreshInterval = 1000 * 60 * 60 * 6

export const getClientStorage = (config: SDKBaseConfig) => {
  let _chains = [] as ExtendedChain[]
  let _rpcUrls = { ...config.rpcUrls } as RPCUrls
  let _chainsUpdatedAt: number | undefined

  const updateRpcUrls = () => {
    _rpcUrls = { ...config.rpcUrls }
    _rpcUrls = getRpcUrlsFromChains(_rpcUrls, _chains, [ChainId.SOL])
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
      // In preloadChains mode, SDK does not auto-fetch chains
      // External consumer is responsible for calling setChains
      if (config.preloadChains) {
        return _chains
      }

      if (this.needReset || !_chains.length) {
        _chains = await _getChains(config, {
          chainTypes: [
            ChainType.EVM,
            ChainType.SVM,
            ChainType.UTXO,
            ChainType.MVM,
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
