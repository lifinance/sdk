import { ChainId, type CoinKey } from '@lifi/types'
import type { Address, Client } from 'viem'
import { readContract } from 'viem/actions'
import { namehash } from 'viem/ens'
import { getAction, trim } from 'viem/utils'
import { getPublicClient } from '../EVM/publicClient.js'

import {
  CHAIN_ID_FAMILY_MAP,
  CHAIN_TYPE_UNS_CHAIN_MAP,
  getUNSProxyAddress,
  UNSProxyReaderABI,
} from './constants.js'

export const resolveUNSAddress = async (
  name: string,
  chain: ChainId,
  token?: CoinKey
): Promise<string | undefined> => {
  try {
    const L1Client = await getPublicClient(ChainId.ETH)
    const L2Client = await getPublicClient(ChainId.POL)

    const nameHash = namehash(name)

    const family = CHAIN_ID_FAMILY_MAP[chain]
    const unschain = CHAIN_TYPE_UNS_CHAIN_MAP[chain]

    if (!family) {
      throw new Error(`Unsupported network: ${chain}`)
    }

    const keys: string[] = []

    if (token && unschain) {
      keys.push(`token.${family}.${unschain}.${token}.address`)
    }

    if (unschain) {
      keys.push(`token.${family}.${unschain}.address`)
    }

    keys.push(`token.${family}.address`)

    for (const key of keys) {
      const address =
        (await getUnsAddress(L2Client, { name: nameHash, key })) ||
        (await getUnsAddress(L1Client, { name: nameHash, key }))
      if (address) {
        return address
      }
    }

    return undefined
  } catch {
    return
  }
}

type GetUnsAddressParameters = {
  key: string
  name: string
}

type GetUnsAddressReturnType = Address | undefined

async function getUnsAddress(
  client: Client,
  params: GetUnsAddressParameters
): Promise<GetUnsAddressReturnType> {
  const { name, key } = params

  const chainId = client.chain?.id
  if (!chainId) {
    throw new Error('Chain ID not available')
  }

  const proxyAddress = getUNSProxyAddress(chainId)
  if (!proxyAddress) {
    throw new Error(`UNS contracts are not deployed on chain ${chainId}`)
  }

  const readContractAction = getAction(client, readContract, 'readContract')

  const existsReadContractParameters = {
    abi: UNSProxyReaderABI,
    address: proxyAddress,
    functionName: 'exists',
    args: [BigInt(name)],
  } as const

  const exists = await readContractAction(existsReadContractParameters)

  if (!exists) {
    return undefined
  }

  const readContractParameters = {
    abi: UNSProxyReaderABI,
    address: proxyAddress,
    functionName: 'getData',
    args: [[key], BigInt(name)],
  } as const

  const res = await readContractAction(readContractParameters)
  const [, , addresses] = res

  const address = addresses[0]

  if (
    address === '0x' ||
    address === '' ||
    trim(address as Address) === '0x00'
  ) {
    return undefined
  }

  return address as Address
}
