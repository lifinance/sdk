import type { RpcMethods } from './types.js'

type BlockchairBalanceResponse = {
  data: Record<string, any>
  context: { code: number; error: string }
}

export const blockchairMethods: RpcMethods = {
  getBalance: async (client, baseUrl, { address }) => {
    const apiUrl = `${baseUrl}/addresses/balances/?addresses=${address}`
    const response = (await client.request({
      url: apiUrl,
      fetchOptions: { method: 'GET' },
    })) as unknown as BlockchairBalanceResponse
    if (response.context?.code !== 200) {
      return {
        error: {
          code: response.context?.code,
          message: response.context?.error,
        },
      }
    }
    return {
      result: BigInt(response.data[address]),
    }
  },
}
