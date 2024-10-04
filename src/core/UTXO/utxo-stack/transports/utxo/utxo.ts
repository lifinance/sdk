import {
  type HttpTransport,
  type HttpTransportConfig,
  RpcRequestError,
  UrlRequiredError,
  createTransport,
} from 'viem'
import { getHttpRpcClient } from './getHttpRpcClient.js'
import { getRpcProviderMethods } from './getRpcProviderMethods.js'
import type { UTXOAPIMethod } from './types.js'

type UTXOHttpTransportConfig = HttpTransportConfig & {
  includeChainToURL?: boolean
}

export function utxo(
  url?: string,
  config: UTXOHttpTransportConfig = {}
): HttpTransport {
  const {
    fetchOptions,
    key = 'utxo',
    name = 'UTXO HTTP API',
    onFetchRequest,
    onFetchResponse,
    retryDelay,
  } = config
  return ({ chain, retryCount: retryCount_, timeout: timeout_ }) => {
    const retryCount = config.retryCount ?? retryCount_
    const timeout = timeout_ ?? config.timeout ?? 10_000
    let url_ = url
    if (config.includeChainToURL) {
      const chainName = chain?.name.replace(' ', '-').toLowerCase()
      url_ = `${url}${chainName ? `/${chainName}` : ''}`
    }
    if (!url_) {
      throw new UrlRequiredError()
    }

    const client = getHttpRpcClient(url_, {
      fetchOptions,
      onRequest: onFetchRequest,
      onResponse: onFetchResponse,
      timeout,
    })

    const rpcMethods = getRpcProviderMethods(key)

    return createTransport(
      {
        key,
        name,
        async request({ method, params }) {
          const body = { method, params }
          const methodHandler = rpcMethods?.[method as UTXOAPIMethod]
          const { error, result } = await (methodHandler?.(
            client,
            url_,
            params
          ) ??
            client.request({
              body,
            }))
          if (error) {
            throw new RpcRequestError({
              body,
              error,
              url: url_,
            })
          }
          return result
        },
        retryCount,
        retryDelay,
        timeout,
        type: 'http',
      },
      {
        fetchOptions,
        url: url_,
      }
    )
  }
}
