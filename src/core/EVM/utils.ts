import type { ChainId } from '@lifi/types'
import type { Client, Transaction } from 'viem'
import { getBlock } from 'viem/actions'
import { config } from '../../config.js'
import { median } from '../../utils/median.js'

export const getMaxPriorityFeePerGas = async (
  client: Client
): Promise<bigint | undefined> => {
  const block = await getBlock(client, {
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
): Promise<string | undefined> => {
  const chains = await config.getChains()
  return chains.find((chain) => chain.id === chainId)?.multicallAddress
}

// Modified viem retryDelay exponential backoff function.
export const retryDelay = ({ count }: { count: number; error: Error }) =>
  Math.min(~~(1 << count) * 200, 3000)

export const retryCount = 30
