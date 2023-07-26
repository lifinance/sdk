import type { PublicClient, Transaction } from 'viem'
import { median } from './median'

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
