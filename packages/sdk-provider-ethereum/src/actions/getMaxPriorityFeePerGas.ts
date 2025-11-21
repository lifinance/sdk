import type { SDKClient } from '@lifi/sdk'
import type { Client, Transaction } from 'viem'
import { getBlock } from 'viem/actions'
import { getActionWithFallback } from '../utils/getActionWithFallback.js'
import { median } from '../utils/median.js'

export const getMaxPriorityFeePerGas = async (
  client: SDKClient,
  viemClient: Client
): Promise<bigint | undefined> => {
  const block = await getActionWithFallback(
    client,
    viemClient,
    getBlock,
    'getBlock',
    {
      includeTransactions: true,
    }
  )

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
