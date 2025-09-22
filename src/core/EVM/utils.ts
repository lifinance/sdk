import type { ChainId, ExtendedChain } from '@lifi/types'
import type { Address, Chain, Client, Transaction, TypedDataDomain } from 'viem'
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

/**
 * Helper function to get the chain ID from a TypedDataDomain.
 * Extracts the chain ID from either the chainId field or the salt field.
 * The salt is expected to be a padded hex string representation of the chainId.
 */
export const getDomainChainId = (domain: TypedDataDomain): number | null => {
  if (domain.chainId) {
    return Number(domain.chainId)
  }
  if (!domain.salt) {
    return null
  }
  try {
    // Convert the hex salt to a number
    // The salt should be a padded 32-byte hex representation of the chainId
    const saltChainId = Number(domain.salt)
    return !Number.isNaN(saltChainId) ? saltChainId : null
  } catch {
    return null
  }
}

/**
 * EIP-7702 introduces delegation designators that allow EOAs to delegate execution to other contracts.
 * A delegation designator starts with 0xef0100 followed by the target contract address.
 *
 * When an EOA has this code, it means:
 * - The EOA can still send transactions (unlike other contract accounts)
 * - All contract calls are delegated to the target address
 * - The code itself remains as the delegation designator (0xef0100 || address)
 *
 * Delegation Designator Structure:
 *
 * ─────┬───┬──┬───────────────────────────────────────┐
 *      │   │  │                                       │
 *  0x ef 0100 a94f5374fce5edbc8e2a8697c15331677e6ebf0b
 *      │   │  └───────────────────────────────────────┘
 *      │   │                         Target Address
 *      │   └── 7702
 *      └── 3541
 *
 * @see https://eips.ethereum.org/EIPS/eip-7702
 */
export const isDelegationDesignatorCode = (code?: string) =>
  code?.startsWith('0xef0100')
