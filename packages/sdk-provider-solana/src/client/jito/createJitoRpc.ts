import {
  type ClusterUrl,
  createDefaultRpcTransport,
  createJsonRpcApi,
  createRpc,
  type Rpc,
  type RpcTransport,
} from '@solana/kit'

import type { GetTipAccountsApi } from './api/getTipAccounts.js'
import type { SendBundleApi } from './api/sendBundle.js'
import type { SimulateBundleApi } from './api/simulateBundle.js'

// Jito-only API type (no Solana base methods)
export type JitoRpcApi = GetTipAccountsApi & SendBundleApi & SimulateBundleApi

// Create the Jito RPC API
function createJitoRpcApi() {
  return createJsonRpcApi<JitoRpcApi>()
}

// Create Jito RPC from a custom transport
export function createJitoRpcFromTransport<TTransport extends RpcTransport>(
  transport: TTransport
): Rpc<JitoRpcApi> {
  return createRpc({
    api: createJitoRpcApi(),
    transport,
  })
}

// Create Jito RPC from a cluster URL
export function createJitoRpc<TClusterUrl extends ClusterUrl>(
  clusterUrl: TClusterUrl,
  config?: Omit<
    Parameters<typeof createDefaultRpcTransport<TClusterUrl>>[0],
    'url'
  >
): Rpc<JitoRpcApi> {
  return createJitoRpcFromTransport(
    createDefaultRpcTransport({ url: clusterUrl, ...config })
  )
}
