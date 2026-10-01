import {
  AllTransportsFailedError,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
} from '@bigmi/core'

/** The LI.FI default BTC RPC, where the node errors below were probed. */
const RPC_URL = 'https://bitcoin-rpc.publicnode.com'

/** A node's JSON-RPC error object, as Bitcoin Core returns it. */
export interface NodeRpcError {
  code: number
  message: string
}

/** Probed 2026-10-01 (read-only): `sendrawtransaction ["00"]`. */
export const DECODE_FAILED: NodeRpcError = {
  code: -22,
  message: 'TX decode failed. Make sure the tx has at least one input.',
}

/** Probed 2026-10-01 (read-only): `getrawtransaction [<unknown txid>, true]`. */
export const NO_SUCH_TRANSACTION: NodeRpcError = {
  code: -5,
  message:
    'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.',
}

/** What bigmi's `http` transport throws for a JSON-RPC error in an HTTP 200 answer. */
export const rpcError = (
  method: string,
  error: NodeRpcError
): RpcRequestError =>
  new RpcRequestError({ body: { method, params: [] }, error, url: RPC_URL })

/**
 * What bigmi's `getHttpRpcClient` throws for a non-2xx answer: `details` is
 * the JSON string of the answer's `error` member.
 */
export const httpError = (
  method: string,
  details: string,
  status = 500
): HttpRequestError =>
  new HttpRequestError({
    body: { method, params: [] },
    details,
    status,
    url: RPC_URL,
  })

/** What bigmi's `getHttpRpcClient` throws after its 10 s request timeout. */
export const timeoutError = (method: string): TimeoutError =>
  new TimeoutError({
    body: { method, params: [] },
    url: RPC_URL,
    timeout: 10_000,
  })

/**
 * What bigmi's `fallback` transport throws once every JSON-RPC URL failed:
 * one entry per URL, from the last retry round. It has no `code`, no
 * `details` and no `cause`.
 */
export const allTransportsFailed = (
  method: string,
  errors: Error[]
): AllTransportsFailedError =>
  new AllTransportsFailedError({
    method,
    params: [],
    errors: errors.map((error, index) => ({
      transport: 'HTTP JSON-RPC',
      error,
      attempt: index + 1,
    })),
    totalAttempts: errors.length,
  })
