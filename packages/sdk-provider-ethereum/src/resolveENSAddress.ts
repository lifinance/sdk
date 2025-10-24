import { ChainId, type SDKClient } from '@lifi/sdk'
import { getEnsAddress, normalize } from 'viem/ens'
import { getPublicClient } from './publicClient.js'

export const resolveENSAddress = async (
  client: SDKClient,
  name: string
): Promise<string | undefined> => {
  try {
    const viemClient = await getPublicClient(client, ChainId.ETH)
    const address = await getEnsAddress(viemClient, {
      name: normalize(name),
    })
    return address as string | undefined
  } catch (_) {
    // ignore
    return
  }
}
