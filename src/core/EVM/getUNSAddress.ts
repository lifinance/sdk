import { ChainId } from '@lifi/types'
import type { Address, Client } from 'viem'
import { readContract } from 'viem/actions'
import { namehash, normalize } from 'viem/ens'
import { getAction, trim } from 'viem/utils'
import { getPublicClient } from './publicClient.js'

// Ethereum ProxyReader contract address
const proxyReaderAddress = '0x1BDc0fD4fbABeed3E611fd6195fCd5d41dcEF393'

const getUnsDataAbi = [
  {
    constant: true,
    inputs: [
      {
        internalType: 'string[]',
        name: 'keys',
        type: 'string[]',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'getData',
    outputs: [
      {
        internalType: 'address',
        name: 'resolver',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
      {
        internalType: 'string[]',
        name: 'values',
        type: 'string[]',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const getUNSAddress = async (
  name: string
): Promise<string | undefined> => {
  try {
    const client = await getPublicClient(ChainId.ETH)
    const address = await getUnsAddress(client, {
      name: namehash(normalize(name)),
    })
    return address as string | undefined
  } catch (_) {
    // ignore
    return
  }
}

type GetUnsAddressParameters = {
  universalResolverAddress?: Address
  name: string
}

type GetUnsAddressReturnType = Address | null

async function getUnsAddress(
  client: Client,
  params: GetUnsAddressParameters
): Promise<GetUnsAddressReturnType> {
  const { name } = params
  // @TODO: make this dynamic, as address is may not be the same for every EVM chain
  const keys = ['crypto.ETH.address']
  const readContractParameters = {
    abi: getUnsDataAbi,
    address: proxyReaderAddress,
    functionName: 'getData',
    args: [keys, BigInt(name)],
  } as const
  const readContractAction = getAction(client, readContract, 'readContract')

  const res = await readContractAction(readContractParameters)

  if (res[0] === '0x') {
    return null
  }
  const address = res[0]
  if (address === '0x') {
    return null
  }
  if (trim(address) === '0x00') {
    return null
  }
  return address
}
