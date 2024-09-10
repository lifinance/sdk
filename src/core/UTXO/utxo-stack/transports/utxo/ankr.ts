import type { RpcMethods } from './types.js'

type AnkrBalanceResponse = {
  address: string
  balance: string
  totalReceived: string
  totalSent: string
  unconfirmedBalance: string
  unconfirmedTxs: number
  txs: number
  error: string
}

export const ankrMethods: RpcMethods = {
  getBalance: async (client, baseUrl, { address }) => {
    const apiUrl = `${baseUrl}/address/${address}?details=basic`
    const response = (await client.request({
      url: apiUrl,
      fetchOptions: { method: 'GET' },
    })) as unknown as AnkrBalanceResponse
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
