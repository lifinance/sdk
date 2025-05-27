import type { ChainId, ExtendedChain } from '@lifi/types'
import type { Address, Chain, Client, Transaction } from 'viem'
import { getBlock } from 'viem/actions'
import { config } from '../../config.js'
import { median } from '../../utils/median.js'
import { getActionWithFallback } from './getActionWithFallback.js'

type ChainBlockExplorer = {
  name: string
  url: string
}

type ChainBlockExplorers = {
  [key: string]: ChainBlockExplorer
  default: ChainBlockExplorer
}

export const convertExtendedChain = (chain: ExtendedChain): Chain => ({
  ...chain,
  ...chain.metamask,
  blockExplorers: chain.metamask.blockExplorerUrls.reduce(
    (blockExplorers, blockExplorer, index) => {
      blockExplorers[index === 0 ? 'default' : `${index}`] = {
        name: blockExplorer,
        url: blockExplorer,
      }
      return blockExplorers
    },
    {} as ChainBlockExplorers
  ),
  name: chain.metamask.chainName,
  rpcUrls: {
    default: { http: chain.metamask.rpcUrls },
    public: { http: chain.metamask.rpcUrls },
  },
  contracts: {
    ...(chain.multicallAddress
      ? { multicall3: { address: chain.multicallAddress as Address } }
      : undefined),
  },
})

export function isExtendedChain(chain: any): chain is ExtendedChain {
  return (
    typeof chain === 'object' &&
    chain !== null &&
    'key' in chain &&
    'chainType' in chain &&
    'coin' in chain &&
    'mainnet' in chain &&
    'logoURI' in chain &&
    typeof chain.metamask === 'object' &&
    chain.metamask !== null &&
    typeof chain.nativeToken === 'object' &&
    chain.nativeToken !== null
  )
}

export const getMaxPriorityFeePerGas = async (
  client: Client
): Promise<bigint | undefined> => {
  const block = await getActionWithFallback(client, getBlock, 'getBlock', {
    includeTransactions: true,
  })

  const maxPriorityFeePerGasList = (block.transactions as Transaction[])
    .filter((tx) => tx.maxPriorityFeePerGas)
    .map((tx) => tx.maxPriorityFeePerGas) as bigint[]

  if (!maxPriorityFeePerGasList.length) {
    return
  }

  let maxPriorityFeePerGasSum = 0n
  for (const value of maxPriorityFeePerGasList) {
    maxPriorityFeePerGasSum += value
  }

  const maxPriorityFeePerGasMedian = median(maxPriorityFeePerGasList) ?? 0n

  const maxPriorityFeePerGasAvg =
    maxPriorityFeePerGasSum / BigInt(maxPriorityFeePerGasList.length)

  return maxPriorityFeePerGasMedian > maxPriorityFeePerGasAvg
    ? maxPriorityFeePerGasAvg
    : maxPriorityFeePerGasMedian
}

// Multicall
export const getMulticallAddress = async (
  chainId: ChainId
): Promise<Address | undefined> => {
  const chains = await config.getChains()
  return chains.find((chain) => chain.id === chainId)
    ?.multicallAddress as Address
}

// Modified viem retryDelay exponential backoff function.
export const retryDelay = ({ count }: { count: number; error: Error }) =>
  Math.min(~~(1 << count) * 200, 3000)

export const retryCount = 30
