import { type ChainId } from '@lifi/types'
import type { PublicClient, Transaction } from 'viem'
import { config } from '../../config.js'
import { median } from '../../utils/median.js'

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
  const chains = await config.getChains()
  return chains.find((chain) => chain.id === chainId)?.multicallAddress
}

// Modified viem retryDelay exponential backoff function.
// Together with adjusted retryCount gives us 25 seconds to wait for the block or transaction.
export const retryDelay = ({ count }: { count: number; error: Error }) =>
  Math.min(~~(1 << count) * 200, 2000)

export const retryCount = 15
