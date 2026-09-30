import type { SDKClient } from '@lifi/sdk'
import type { TronWeb } from 'tronweb'
import { tronWebCache } from './callTronRpcsWithRetry.js'

/**
 * Seeds one fake TronWeb per RPC URL (`https://rpc-<index>.example`) and
 * returns a client that lists these URLs in the same order. The real
 * `callTronRpcsWithRetry` then tries the fake nodes in turn, so a test
 * controls the answer of every node. Clears `tronWebCache` first.
 */
export function withTronNodes(...nodes: unknown[]): SDKClient {
  tronWebCache.clear()
  const urls = nodes.map((_, index) => `https://rpc-${index}.example`)
  nodes.forEach((node, index) => {
    tronWebCache.set(urls[index], node as TronWeb)
  })
  return { getRpcUrlsByChainId: async () => urls } as unknown as SDKClient
}
