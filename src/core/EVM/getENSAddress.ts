import { ChainId } from '@lifi/types'
import { normalize } from 'viem/ens'
import { getPublicClient } from './publicClient.js'

export const getENSAddress = async (
  name: string
): Promise<string | undefined> => {
  try {
    const client = await getPublicClient(ChainId.ETH)
    const address = await client.getEnsAddress({
      name: normalize(name),
    })
    return address as string | undefined
  } catch (_) {
    // ignore
    return
  }
}
