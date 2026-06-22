import type { SuiClientTypes } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'

export async function getSuiNSAddress(
  name: string,
  rpcUrl?: string,
  network?: SuiClientTypes.Network
): Promise<string | undefined> {
  const client = new SuiGrpcClient({
    network: network || 'mainnet',
    baseUrl: rpcUrl || 'https://fullnode.mainnet.sui.io:443',
  })

  try {
    const { response } = await client.nameService.lookupName({ name })
    return response.record?.targetAddress
  } catch (error) {
    console.error('Error resolving SuiNS address:', error)
    return
  }
}
