import { ChainId, ChainType, type ExtendedChain } from '@lifi/types'
import { getChainsFromConfig } from '../actions/getChains.js'
import { getRpcUrlsFromChains } from '../core/utils.js'
import type { RPCUrls, SDKBaseConfig } from '../types/core.js'

export const getClientStorage = (config: SDKBaseConfig) => {
  let _chains = [] as ExtendedChain[]
  let _rpcUrls = { ...config.rpcUrls } as RPCUrls
  let _chainsUpdatedAt: number | undefined
  let _rpcUrlsMerged = false

  return {
    get needReset() {
      return (
        !_chainsUpdatedAt ||
        Date.now() - _chainsUpdatedAt >= 1000 * 60 * 60 * 24
      )
    },
    async getChains() {
      if (this.needReset || !_chains.length) {
        _chains = await getChainsFromConfig(config, {
          chainTypes: [
            ChainType.EVM,
            ChainType.SVM,
            ChainType.UTXO,
            ChainType.MVM,
          ],
        })
        _chainsUpdatedAt = Date.now()
      }
      return _chains
    },
    async getRpcUrls() {
      if (this.needReset || !_rpcUrlsMerged) {
        const chains = await this.getChains()
        _rpcUrls = getRpcUrlsFromChains(_rpcUrls, chains, [ChainId.SOL])
        _rpcUrlsMerged = true
      }
      return _rpcUrls
    },
  }
}
