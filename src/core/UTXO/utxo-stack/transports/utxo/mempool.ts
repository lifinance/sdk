import type { RpcMethods } from './types.js'

type MempoolBalanceResponse = {
  address: string
  chain_stats: {
    funded_txo_count: number
    funded_txo_sum: number
    spent_txo_count: number
    spent_txo_sum: number
    tx_count: number
  }
  mempool_stats: {
    funded_txo_count: number
    funded_txo_sum: number
    spent_txo_count: number
    spent_txo_sum: number
    tx_count: number
  }
}

export const mempoolMethods: RpcMethods = {
  getBalance: async (client, baseUrl, { address }) => {
    const apiUrl = `${baseUrl}/address/${address}`
    const response = (await client.request({
      url: apiUrl,
      fetchOptions: { method: 'GET' },
    })) as unknown as MempoolBalanceResponse
    const balance =
      response.chain_stats.funded_txo_sum - response.chain_stats.spent_txo_sum
    return {
      result: BigInt(balance),
    }
  },
}
