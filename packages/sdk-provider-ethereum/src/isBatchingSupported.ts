import type { SDKClient } from '@lifi/sdk'
import { sleep } from '@lifi/sdk'
import { ChainType } from '@lifi/types'
import type { Client } from 'viem'
import { getCapabilities } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { EthereumSDKProvider } from './types.js'

export async function isBatchingSupported(
  client: SDKClient,
  {
    client: viemClient,
    chainId,
    skipReady = false,
  }: {
    client?: Client
    chainId: number
    skipReady?: boolean
  }
): Promise<boolean> {
  const _client =
    viemClient ??
    (await (
      client.getProvider(ChainType.EVM) as EthereumSDKProvider
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
