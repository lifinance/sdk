import type {
  BlockchairAddressResponse,
  BlockchairMultipleBalancesResponse,
  BlockchairOutputsResponse,
  BlockchairRawTransactionResponse,
  BlockchairResponse,
  UTXOChain,
  UTXOType,
} from './blockchairApiTypes.js'
import { Chain } from './blockchairApiTypes.js'
import { RequestClient } from './requestClient.js'

type BlockchairParams<T> = T & { chain: Chain; apiKey?: string }

const baseUrl = (chain: Chain) =>
  `https://api.blockchair.com/${mapChainToBlockchairChain(chain)}`

const getDefaultTxFeeByChain = (chain: Chain) => {
  switch (chain) {
    case Chain.Bitcoin:
      return 5
    case Chain.Dogecoin:
      return 10000
    case Chain.Litecoin:
      return 1
    default:
      return 2
  }
}

const mapChainToBlockchairChain = (chain: Chain) => {
  switch (chain) {
    case Chain.BitcoinCash:
      return 'bitcoin-cash'
    case Chain.Litecoin:
      return 'litecoin'
    case Chain.Dash:
      return 'dash'
    case Chain.Dogecoin:
      return 'dogecoin'
    case Chain.Polkadot:
      return 'polkadot'
    default:
      return 'bitcoin'
  }
}

const getSuggestedTxFee = async (chain: Chain) => {
  try {
    //Use Bitgo API for fee estimation
    //Refer: https://app.bitgo.com/docs/#operation/v2.tx.getfeeestimate
    const { feePerKb } = await RequestClient.get<{
      feePerKb: number
      cpfpFeePerKb: number
      numBlocks: number
      feeByBlockTarget: { 1: number; 3: number }
    }>(`https://app.bitgo.com/api/v2/${chain.toLowerCase()}/tx/fee`)
    const suggestedFee = feePerKb / 1000

    return Math.max(suggestedFee, getDefaultTxFeeByChain(chain))
  } catch (_error) {
    return getDefaultTxFeeByChain(chain)
  }
}

const blockchairRequest = async <T>(
  url: string,
  apiKey?: string
): Promise<T> => {
  try {
    const response = await RequestClient.get<BlockchairResponse<T>>(url)
    if (!response || response.context.code !== 200) {
      throw new Error(`failed to query ${url}`)
    }

    return response.data as T
  } catch (error) {
    if (!apiKey) {
      throw error
    }
    const response = await RequestClient.get<BlockchairResponse<T>>(
      `${url}${apiKey ? `&key=${apiKey}` : ''}`
    )

    if (!response || response.context.code !== 200) {
      throw new Error(`failed to query ${url}`)
    }

    return response.data as T
  }
}

const baseAddressData = {
  utxo: [],
  address: { balance: 0, transaction_count: 0 },
}
const getAddressData = async ({
  address,
  chain,
  apiKey,
}: BlockchairParams<{ address?: string }>) => {
  if (!address) {
    throw new Error('address is required')
  }

  try {
    const response = await blockchairRequest<BlockchairAddressResponse>(
      `${baseUrl(chain)}/dashboards/address/${address}?transaction_details=true`,
      apiKey
    )

    return response[address]
  } catch (_error) {
    return baseAddressData
  }
}

const getUnconfirmedBalance = async ({
  address,
  chain,
  apiKey,
}: BlockchairParams<{ address?: string }>) => {
  const response = await getAddressData({ address, chain, apiKey })

  return response?.address.balance
}

const getConfirmedBalance = async ({
  chain,
  address,
  apiKey,
}: BlockchairParams<{ address?: string }>) => {
  if (!address) {
    throw new Error('address is required')
  }
  try {
    const response =
      await blockchairRequest<BlockchairMultipleBalancesResponse>(
        `${baseUrl(chain)}/addresses/balances?addresses=${address}`,
        apiKey
      )

    return response[address] || 0
  } catch (_error) {
    return 0
  }
}

const getRawTx = async ({
  chain,
  apiKey,
  txHash,
}: BlockchairParams<{ txHash?: string }>) => {
  if (!txHash) {
    throw new Error('txHash is required')
  }

  try {
    const rawTxResponse =
      await blockchairRequest<BlockchairRawTransactionResponse>(
        `${baseUrl(chain)}/raw/transaction/${txHash}`,
        apiKey
      )
    return rawTxResponse?.[txHash]?.raw_transaction
  } catch (error) {
    console.error(error)
    return ''
  }
}

const getUnspentTxs = async ({
  chain,
  address,
  apiKey,
  offset = 0,
}: BlockchairParams<{ offset?: number; address: string }>): Promise<
  (UTXOType & { script_hex: string; is_confirmed: boolean })[]
> => {
  if (!address) {
    throw new Error('address is required')
  }
  try {
    const response = await blockchairRequest<BlockchairOutputsResponse[]>(
      `${baseUrl(
        chain
      )}/outputs?q=is_spent(false),recipient(${address})&limit=100&offset=${offset}`,
      apiKey
    )

    const txs = response
      .filter(({ is_spent }) => !is_spent)
      .map(
        ({
          script_hex,
          block_id,
          transaction_hash,
          index,
          value,
          spending_signature_hex,
        }) => ({
          hash: transaction_hash,
          index,
          value,
          txHex: spending_signature_hex,
          script_hex,
          is_confirmed: block_id !== -1,
        })
      ) as (UTXOType & { script_hex: string; is_confirmed: boolean })[]

    if (response.length !== 100) {
      return txs
    }

    const nextBatch = await getUnspentTxs({
      address,
      chain,
      apiKey,
      offset: response?.[99]?.transaction_id,
    })

    return txs.concat(nextBatch)
  } catch (error) {
    console.error(error)
    return []
  }
}

const scanUTXOs = async ({
  address,
  chain,
  apiKey,
  fetchTxHex = true,
}: BlockchairParams<{ address: string; fetchTxHex?: boolean }>) => {
  const utxos = await getUnspentTxs({ chain, address, apiKey })
  const results = []

  for (const { hash, index, script_hex, value } of utxos) {
    let txHex: string | undefined
    if (fetchTxHex) {
      txHex = await getRawTx({ txHash: hash, chain, apiKey })
    }
    results.push({
      address,
      hash,
      index,
      txHex,
      value,
      witnessUtxo: { value, script: Buffer.from(script_hex, 'hex') },
    })
  }
  return results
}

export const blockchairApi = ({
  apiKey,
  chain,
}: {
  apiKey?: string
  chain: UTXOChain
}) => ({
  getConfirmedBalance: (address: string) =>
    getConfirmedBalance({ chain, address, apiKey }),
  getRawTx: (txHash: string) => getRawTx({ txHash, chain, apiKey }),
  getSuggestedTxFee: () => getSuggestedTxFee(chain),
  getBalance: (address: string) =>
    getUnconfirmedBalance({ address, chain, apiKey }),
  getAddressData: (address: string) =>
    getAddressData({ address, chain, apiKey }),
  scanUTXOs: (params: { address: string; fetchTxHex?: boolean }) =>
    scanUTXOs({ ...params, chain, apiKey }),
})

export type BlockchairApiType = ReturnType<typeof blockchairApi>
