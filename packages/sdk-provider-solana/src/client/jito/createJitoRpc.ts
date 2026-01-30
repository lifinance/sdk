import {
  type ClusterUrl,
  createDefaultRpcTransport,
  createRpc,
  createSolanaRpcApi,
  type Rpc,
  type RpcTransport,
  type SolanaRpcApi,
} from '@solana/kit'

import type { GetBundleStatusesApi } from './api/getBundleStatuses.js'
import type { GetTipAccountsApi } from './api/getTipAccounts.js'
import type { SendBundleApi } from './api/sendBundle.js'
import type { SimulateBundleApi } from './api/simulateBundle.js'

// Jito-specific methods API type
export type JitoBundleApi = GetBundleStatusesApi &
  GetTipAccountsApi &
  SendBundleApi &
  SimulateBundleApi

// Combined Jito RPC API type (Jito methods + standard Solana methods)
export type JitoRpcApi = JitoBundleApi & SolanaRpcApi

// Create the Jito RPC API with Solana transforms
function createJitoRpcApi() {
  return createSolanaRpcApi<JitoRpcApi>()
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
