import type { BlockStats, BlockStatsKeys } from '../../types/blockStats.js'
import type { UTXOTransaction } from '../../types/transaction.js'
import type { HttpRpcClient } from './getHttpRpcClient.js'

export type UTXOSchema = [
  {
    Method: 'getblockcount'
    Parameters: []
    ReturnType: number
  },
  {
    Method: 'getblockhash'
    Parameters: [number]
    ReturnType: string
  },
  {
    Method: 'getblock'
    Parameters: [string, number]
    ReturnType: string
  },
  {
    Method: 'getblockstats'
    Parameters: [string | number, Array<BlockStatsKeys>?]
    ReturnType: BlockStats
  },
  {
    Method: 'sendrawtransaction'
    Parameters: [string, number?]
    ReturnType: string
  },
  {
    Method: 'getrawtransaction'
    Parameters: [string, boolean, string?]
    ReturnType: UTXOTransaction
  },
]

export type UTXOAPISchema = [
  {
    Method: 'getBalance'
    Parameters: { address: string }
    ReturnType: bigint
  },
]

export type UTXOAPIMethod = UTXOAPISchema[number]['Method']

export type SuccessResult<result> = {
  method?: undefined
  result: result
  error?: undefined
}
export type ErrorResult<error> = {
  method?: undefined
  result?: undefined
  error: error
}

export type RpcResponse<result = any, error = any> =
  | SuccessResult<result>
  | ErrorResult<error>

export type RpcMethodHandler = (
  client: HttpRpcClient,
  baseUrl: string,
  params: any
) => Promise<RpcResponse>

export type RpcMethods = {
  [key in UTXOAPIMethod]: RpcMethodHandler
}
