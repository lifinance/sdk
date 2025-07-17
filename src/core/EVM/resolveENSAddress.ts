import { ChainId } from '@lifi/types'
import { getEnsAddress, normalize } from 'viem/ens'
import { getPublicClient } from './publicClient.js'

export const resolveENSAddress = async (
  name: string
): Promise<string | undefined> => {
  try {
    const client = await getPublicClient(ChainId.ETH)
    const address = await getEnsAddress(client, {
      name: normalize(name),
    })
    return address as string | undefined
  } catch (_) {
    // ignore
    return
  }
}
