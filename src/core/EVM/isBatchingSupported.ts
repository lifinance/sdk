import { ChainType } from '@lifi/types'
import type { Client } from 'viem'
import { getCapabilities } from 'viem/actions'
import { getAction } from 'viem/utils'
import { config } from '../../config.js'
import { sleep } from '../../utils/sleep.js'
import type { EVMProvider } from './types.js'

export async function isBatchingSupported({
  client,
  chainId,
  skipReady = false,
}: {
  client?: Client
  chainId: number
  skipReady?: boolean
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
    const capabilities = await Promise.race([
      getAction(_client, getCapabilities, 'getCapabilities')({ chainId }),
      sleep(2_000),
    ])
    return (
      capabilities?.atomicBatch?.supported ||
      capabilities?.atomic?.status === 'supported' ||
      (!skipReady && capabilities?.atomic?.status === 'ready') ||
      false
    )
  } catch {
    // If the wallet does not support getCapabilities or the call fails,
    // we assume that atomic batch is not supported
    return false
  }
}
