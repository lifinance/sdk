import type { SuiClientTypes } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'

// @mysten/sui 3 removed the JSON-RPC helpers: getJsonRpcFullnodeUrl now throws.
const SUI_MAINNET_FULLNODE_URL = 'https://fullnode.mainnet.sui.io:443'

export async function getSuiNSAddress(
  name: string,
  rpcUrl?: string,
  network?: SuiClientTypes.Network
): Promise<string | undefined> {
  const client = new SuiGrpcClient({
    network: network || 'mainnet',
    baseUrl: rpcUrl || SUI_MAINNET_FULLNODE_URL,
  })

  try {
    const { response } = await client.nameService.lookupName({ name })
    return response.record?.targetAddress
  } catch (error) {
    console.error('Error resolving SuiNS address:', error)
    return
  }
}
