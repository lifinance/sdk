import { ChainId } from '@lifi/types'
import type { Address, Client } from 'viem'
import { readContract } from 'viem/actions'
import { namehash } from 'viem/ens'
import { getAction, trim } from 'viem/utils'
import { getPublicClient } from '../publicClient.js'

import {
  CHAIN_ID_UNS_CHAIN_MAP,
  UNSProxyReaderABI,
  getUNSProxyAddress,
} from './constants.js'

export const getUNSAddress = async (
  name: string,
  chain: ChainId
): Promise<string | undefined> => {
  try {
    const L1Client = await getPublicClient(ChainId.ETH)
    const L2Client = await getPublicClient(ChainId.POL)

    const nameHash = namehash(name)

    const unsChain = CHAIN_ID_UNS_CHAIN_MAP[chain]

    const address =
      (await getUnsAddress(L2Client, {
        name: nameHash,
        chain: unsChain,
      })) ||
      (await getUnsAddress(L1Client, {
        name: nameHash,
        chain: unsChain,
      }))

    return address || undefined
  } catch (_) {
    // ignore
    return
  }
}

type GetUnsAddressParameters = {
  chain: string
  name: string
  token?: string
}

type GetUnsAddressReturnType = Address | null

async function getUnsAddress(
  client: Client,
  params: GetUnsAddressParameters
): Promise<GetUnsAddressReturnType> {
  const { name, chain } = params

  // TODO: For more robust resolution, we should construct the keys based on the token and not the chain
  const keys = [`crypto.${chain}.address`]

  try {
    const chainId = client.chain?.id
    if (!chainId) {
      throw new Error('Chain ID not available')
    }

    const proxyAddress = getUNSProxyAddress(chainId)
    if (!proxyAddress) {
      throw new Error(`UNS contracts not deployed on chain ${chainId}`)
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
      return null
    }

    const readContractParameters = {
      abi: UNSProxyReaderABI,
      address: proxyAddress,
      functionName: 'getData',
      args: [keys, BigInt(name)],
    } as const

    const res = await readContractAction(readContractParameters)
    const [, , addresses] = res

    const address = addresses[0]

    if (
      address === '0x' ||
      address === '' ||
      trim(address as Address) === '0x00'
    ) {
      return null
    }

    return address as Address
  } catch {
    return null
  }
}
