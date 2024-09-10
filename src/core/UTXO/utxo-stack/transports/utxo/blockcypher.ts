import type { RpcMethods } from './types.js'

type BlockcypherBalanceResponse = {
  address: string
  total_received: number
  total_sent: number
  balance: number
  unconfirmed_balance: number
  final_balance: number
  n_tx: number
  unconfirmed_n_tx: number
  final_n_tx: number
  error?: string
}

export const blockcypherMethods: RpcMethods = {
  getBalance: async (client, baseUrl, { address }) => {
    const apiUrl = `${baseUrl}/addrs/${address}`
    const response = (await client.request({
      url: apiUrl,
      fetchOptions: { method: 'GET' },
    })) as unknown as BlockcypherBalanceResponse
    if (response.error) {
      return {
        error: { code: -1, message: response.error },
      }
    }
    return {
      result: BigInt(response.balance),
    }
  },
}
