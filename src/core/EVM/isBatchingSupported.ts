import { ChainType } from '@lifi/types'
import type { Client } from 'viem'
import { getCapabilities } from 'viem/experimental'
import type { GetCapabilitiesReturnType } from 'viem/experimental'
import { getAction } from 'viem/utils'
import { config } from '../../config.js'
import type { EVMProvider } from './types.js'

export async function isBatchingSupported({
  client,
  chainId,
}: {
  client?: Client
  chainId: number
}): Promise<boolean> {
  const _client =
    client ??
    (await (
      config.getProvider(ChainType.EVM) as EVMProvider
    )?.getWalletClient?.())

  if (!_client) {
    throw new Error('WalletClient is not provided.')
  }

  try {
    const capabilities = (await getAction(
      _client,
      getCapabilities,
      'getCapabilities'
    )(undefined)) as GetCapabilitiesReturnType
    return capabilities[chainId]?.atomicBatch?.supported ?? false
  } catch {
    // If the wallet does not support getCapabilities or the call fails,
    // we assume that atomic batch is not supported
    return false
  }
}
