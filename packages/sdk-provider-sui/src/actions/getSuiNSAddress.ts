import type { SuiClientTypes } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

export async function getSuiNSAddress(
  name: string,
  rpcUrl?: string,
  network?: SuiClientTypes.Network
): Promise<string | undefined> {
  const client = new SuiGrpcClient({
    network: network || 'mainnet',
    baseUrl: rpcUrl || getJsonRpcFullnodeUrl('mainnet'),
  })

  try {
    const { response } = await client.nameService.lookupName({ name })
    return response.record?.targetAddress
  } catch (error) {
    console.error('Error resolving SuiNS address:', error)
    return
  }
}
