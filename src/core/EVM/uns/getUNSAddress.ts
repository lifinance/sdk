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

    const unsChain = CHAIN_ID_UNS_CHAIN_MAP[chain] || 'ETH'

    const address =
      (await getUnsAddress(L2Client, { name: nameHash, chain: unsChain })) ||
      (await getUnsAddress(L1Client, { name: nameHash, chain: unsChain }))

    return address || undefined
  } catch (_) {
    // ignore
    return
  }
}

type GetUnsAddressParameters = {
  chain: string
  name: string
}

type GetUnsAddressReturnType = Address | null

async function getUnsAddress(
  client: Client,
  params: GetUnsAddressParameters
): Promise<GetUnsAddressReturnType> {
  const { name, chain } = params
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

    const readContractParameters = {
      abi: UNSProxyReaderABI,
      address: proxyAddress,
      // @TODO: call the exists method to check if an address exists before trying to fetch it
      functionName: 'getData',
      args: [keys, BigInt(name)],
    } as const

    const readContractAction = getAction(client, readContract, 'readContract')
    const res = await readContractAction(readContractParameters)
    const [, , addresses] = res

    if (addresses[0] === '0x') {
      return null
    }
    const address = addresses[0]
    if (address === '0x' || address === '') {
      return null
    }

    if (trim(address as Address) === '0x00') {
      return null
    }
    return address as Address
  } catch {
    return null
  }
}
