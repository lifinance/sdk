import { ChainType } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { getChains } from '../services/api.js'

export async function getChainsFromCache(client: SDKClient) {
  let chains = client._storage?.chains
  // Update chains in config cache every 24 hours
  if (
    !client._storage.chainsUpdatedAt ||
    Date.now() - client._storage.chainsUpdatedAt >= 1000 * 60 * 60 * 24
  ) {
    chains = await getChains(client.config, {
      chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
    })
    client._storage.setChains(chains)
  }
  return chains
}
