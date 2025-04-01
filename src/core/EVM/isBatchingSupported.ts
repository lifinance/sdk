import { ChainType } from '@lifi/types'
import type {
  Chain,
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

export async function getCapabilities<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
  parameters: GetCapabilitiesParameters = {}
): Promise<GetCapabilitiesReturnType> {
  const account_raw = parameters?.account ?? client.account

  if (!account_raw) {
    throw new Error('Account not found')
  }
  const account = parseAccount(account_raw)

  const capabilities_raw = await client.request(
    {
      method: 'wallet_getCapabilities',
      params: [account.address],
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
  return capabilities
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
