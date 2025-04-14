import { ChainType } from '@lifi/types'
import type {
  Client,
  Transport,
  WalletCapabilities,
  WalletCapabilitiesRecord,
} from 'viem'
import { parseAccount } from 'viem/accounts'
import type {
  GetCapabilitiesParameters,
  GetCapabilitiesReturnType,
} from 'viem/experimental'
import { getAction } from 'viem/utils'
import { config } from '../../config.js'
import type { EVMProvider } from './types.js'

export async function getCapabilities<
  chainId extends number | undefined = undefined,
>(
  client: Client<Transport>,
  parameters: GetCapabilitiesParameters<chainId> = {}
): Promise<GetCapabilitiesReturnType<chainId>> {
  const { account = client.account, chainId } = parameters

  const account_ = account ? parseAccount(account) : undefined

  const capabilities_raw = await client.request(
    {
      method: 'wallet_getCapabilities',
      params: [account_?.address],
    },
    {
      dedupe: true,
      retryCount: 0,
    }
  )

  const capabilities = {} as WalletCapabilitiesRecord<
    WalletCapabilities,
    number
  >
  for (const [key, value] of Object.entries(capabilities_raw)) {
    capabilities[Number(key)] = value
  }
  return (
    typeof chainId === 'number' ? capabilities[chainId] : capabilities
  ) as never
}

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
    const capabilities = await getAction(
      _client,
      getCapabilities,
      'getCapabilities'
    )({ chainId })
    return (
      capabilities?.atomicBatch?.supported ||
      capabilities?.atomic?.status === 'supported' ||
      capabilities?.atomic?.status === 'ready' ||
      false
    )
  } catch {
    // If the wallet does not support getCapabilities or the call fails,
    // we assume that atomic batch is not supported
    return false
  }
}
