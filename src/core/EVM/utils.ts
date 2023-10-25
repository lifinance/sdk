import { ChainType, type ChainId } from '@lifi/types'
import type { PublicClient, Transaction } from 'viem'
import { median } from '../../utils/median.js'
import { getProvider } from '../provider.js'
import type { EVMProvider } from './types.js'

export const getMaxPriorityFeePerGas = async (
  client: PublicClient
): Promise<bigint | undefined> => {
  const block = await client.getBlock({
    includeTransactions: true,
  })

  const maxPriorityFeePerGasList = (block.transactions as Transaction[])
    .filter((tx) => tx.maxPriorityFeePerGas)
    .map((tx) => tx.maxPriorityFeePerGas) as bigint[]

  if (!maxPriorityFeePerGasList.length) {
    return
  }

  const maxPriorityFeePerGasSum = maxPriorityFeePerGasList.reduce(
    (acc, value) => (acc += value),
    0n
  )

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
  const provider = getProvider<EVMProvider>(ChainType.EVM)
  return provider.multicall?.[chainId]
}