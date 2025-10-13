import { ChainId } from '@lifi/types'
import { getEnsAddress, normalize } from 'viem/ens'
import type { SDKBaseConfig } from '../../types/internal.js'
import { getPublicClient } from './publicClient.js'

export const resolveENSAddress = async (
  config: SDKBaseConfig,
  name: string
): Promise<string | undefined> => {
  try {
    const client = await getPublicClient(config, ChainId.ETH)
    const address = await getEnsAddress(client, {
      name: normalize(name),
    })
    return address as string | undefined
  } catch (_) {
    // ignore
    return
  }
}
