import {
  AllTransportsFailedError,
  HttpRequestError,
  RpcRequestError,
} from '@bigmi/core'
import { ChainId, type SDKClient } from '@lifi/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DECODE_FAILED } from '../core/tasks/bitcoinRpcErrors.unit.mock.js'
import { classifyBitcoinSendFailure } from '../core/tasks/classifyBitcoinSendFailure.js'
import { getBitcoinPublicClient } from './publicClient.js'

const URL_A = 'https://btc-a.example/'
const URL_B = 'https://btc-b.example/'
const TX_HEX = '0200000000010100'

/** Only what `getBitcoinPublicClient` reads from the SDK client. */
const sdkClient = {
  getRpcUrlsByChainId: async () => [URL_A, URL_B],
  getChainById: async () => ({
    id: ChainId.BTC,
    metamask: {
      chainId: String(ChainId.BTC),
      chainName: 'Bitcoin',
      rpcUrls: [URL_A, URL_B],
      blockExplorerUrls: ['https://mempool.space/'],
      nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 8 },
    },
  }),
} as unknown as SDKClient

/**
 * Every URL refuses the bytes. URL A answers as a JSON-RPC 2.0 node (HTTP
 * 200 with an `error` member), URL B as a legacy node (HTTP 500 with the
 * same body). A new `Response` per call: a body can be read only once.
 */
const stubRefusingNodes = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const { id } = JSON.parse(String(init?.body)) as { id: number }
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: null,
        error: DECODE_FAILED,
      }),
      {
        status: String(url) === URL_A ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const fetchesTo = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map(([url]) => String(url))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getBitcoinPublicClient sendrawtransaction', () => {
  // The sign task's one-round proof rests on bigmi internals: the fallback
  // gives each URL `retryCount: 0`, and the override stops the retry of the
  // whole round. A bigmi release that changes either breaks this test.
  it('sends one round with one fetch per URL and keeps one error per URL', async () => {
    const fetchMock = stubRefusingNodes()
    const client = await getBitcoinPublicClient(sdkClient, ChainId.BTC)

    // The same call as BitcoinSignAndExecuteTask.
    const thrown = await client
      .request(
        { method: 'sendrawtransaction', params: [TX_HEX] },
        { retryCount: 0 }
      )
      .catch((error: unknown) => error)

    expect(fetchesTo(fetchMock)).toEqual([URL_A, URL_B])
    expect(thrown).toBeInstanceOf(AllTransportsFailedError)
    // One entry per URL, in URL order: A's JSON-RPC error, B's HTTP 500.
    expect(
      (thrown as AllTransportsFailedError).errors.map(({ error }) =>
        error instanceof RpcRequestError
          ? 'rpc'
          : error instanceof HttpRequestError
            ? `http ${error.status}`
            : 'other'
      )
    ).toEqual(['rpc', 'http 500'])
    expect(classifyBitcoinSendFailure(thrown)).toBe('refused')
  })
})
