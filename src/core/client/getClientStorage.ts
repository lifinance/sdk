import { ChainId, ChainType, type ExtendedChain } from '@lifi/types'
import { getChains } from '../../services/api.js'
import type { RPCUrls, SDKBaseConfig } from '../types.js'
import { getRpcUrlsFromChains } from '../utils.js'

export const getClientStorage = (config: SDKBaseConfig) => {
  let _chains = [] as ExtendedChain[]
  let _rpcUrls = { ...config.rpcUrls } as RPCUrls
  let _chainsUpdatedAt: number | undefined

  return {
    get needReset() {
      return (
        !_chainsUpdatedAt ||
        Date.now() - _chainsUpdatedAt >= 1000 * 60 * 60 * 24
      )
    },
    async getChains() {
      if (this.needReset || !_chains.length) {
        _chains = await getChains(config, {
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
      if (this.needReset || !Object.keys(_rpcUrls).length) {
        const chains = await this.getChains()
        _rpcUrls = getRpcUrlsFromChains(_rpcUrls, chains, [ChainId.SOL])
      }
      return _rpcUrls
    },
  }
}
