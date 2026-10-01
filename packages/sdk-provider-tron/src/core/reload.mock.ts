/**
 * Fixtures for the Tron reload specs (`reload.unit.spec.ts`).
 *
 * The specs drive `executeRoute` / `resumeRoute` with the real
 * `TronStepExecutor`, the real pipeline and real `TronWeb` instances. Two
 * seams, both at the network boundary:
 *
 * - `providers.HttpProvider.prototype.request` from `tronweb`: every TronWeb
 *   call to a full node or solidity node ends there (TronWeb uses axios, not
 *   `fetch`). {@link FakeTronNode.request} answers the endpoints below and
 *   records any other endpoint in `unsupported`.
 * - `globalThis.fetch`: the LI.FI API (`/advanced/stepTransaction`, `/status`).
 *
 * `.mock.ts` keeps this file out of `dist`.
 */
import {
  ChainId,
  ChainType,
  createClient,
  type ExecutionAction,
  type ExtendedChain,
  type LiFiStep,
  type LiFiStepExtended,
  type Route,
  type RouteExtended,
  type SDKClient,
  type SDKProvider,
  type Token,
  type TokenAmount,
} from '@lifi/sdk'
import type {
  Adapter,
  SignedTransaction,
  Transaction,
} from '@tronweb3/tronwallet-abstract-adapter'
import { TronWeb, utils } from 'tronweb'
import { type Mock, vi } from 'vitest'
import { TronProvider } from '../TronProvider.js'

export const API_URL = 'https://api.lifi.test/v1'
export const TRON_RPC_URLS: string[] = [
  'https://tron-a.test',
  'https://tron-b.test',
]

const OWNER_HEX = `41${'11'.repeat(20)}`
const ROUTER_HEX = `41${'22'.repeat(20)}`
export const WALLET_ADDRESS: string = TronWeb.address.fromHex(OWNER_HEX)
const WALLET_SIGNATURE = 'ab'.repeat(65)

const TRX_TOKEN = {
  address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
  chainId: ChainId.TRN,
  symbol: 'TRX',
  decimals: 6,
  name: 'TRON',
  priceUSD: '0.3',
  coinKey: 'TRX',
  logoURI: '',
} as unknown as Token

const USDT_TOKEN = {
  address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  chainId: ChainId.TRN,
  symbol: 'USDT',
  decimals: 6,
  name: 'Tether USD',
  priceUSD: '1',
  coinKey: 'USDT',
  logoURI: '',
} as unknown as Token

const TRON_CHAIN = {
  id: ChainId.TRN,
  key: 'trn',
  chainType: ChainType.TVM,
  name: 'Tron',
  coin: 'TRX',
  mainnet: true,
  logoURI: '',
  nativeToken: TRX_TOKEN,
  metamask: {
    chainId: '0x2b6653dc',
    chainName: 'Tron',
    nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
    rpcUrls: TRON_RPC_URLS,
    blockExplorerUrls: ['https://tronscan.test/'],
  },
} as unknown as ExtendedChain

/**
 * `raw_data_hex` of a TriggerSmartContract call, as the backend sends it in
 * `transactionRequest.data`. `variant` changes the call data, so every quote
 * has its own txID.
 */
export const buildRawDataHex = (variant: number): string => {
  const now = Date.now()
  const rawData = {
    contract: [
      {
        parameter: {
          value: {
            data: `a9059cbb${variant.toString(16).padStart(64, '0')}${'00'.repeat(32)}`,
            owner_address: OWNER_HEX,
            contract_address: ROUTER_HEX,
            call_value: 0,
          },
          type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
        },
        type: 'TriggerSmartContract',
      },
    ],
    ref_block_bytes: '0001',
    ref_block_hash: '0000000000000001',
    expiration: now + 60_000,
    timestamp: now,
    fee_limit: 100_000_000,
  }
  return utils.transaction.txPbToRawDataHex(
    utils.transaction.txJsonToPb({ raw_data: rawData, visible: false } as never)
  )
}

export const buildStep = (): LiFiStepExtended =>
  ({
    id: 'reload-step',
    type: 'lifi',
    tool: 'sunswap',
    toolDetails: { key: 'sunswap', name: 'SunSwap', logoURI: '' },
    action: {
      fromChainId: ChainId.TRN,
      toChainId: ChainId.TRN,
      fromToken: TRX_TOKEN,
      toToken: USDT_TOKEN,
      fromAmount: '1000000',
      slippage: 0.005,
      fromAddress: WALLET_ADDRESS,
      toAddress: WALLET_ADDRESS,
    },
    estimate: {
      fromAmount: '1000000',
      fromAmountUSD: '0.3',
      toAmount: '300000',
      toAmountMin: '298500',
      toAmountUSD: '0.3',
      approvalAddress: '',
      skipApproval: true,
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
      tool: 'sunswap',
    },
    includedSteps: [],
    transactionRequest: { data: `0x${buildRawDataHex(0)}` },
  }) as unknown as LiFiStepExtended

let routeCounter = 0

/** A one-step route with a unique id (execution state is keyed by route id). */
export const buildRoute = (step: LiFiStepExtended): Route => {
  routeCounter += 1
  return {
    id: `tron-reload-route-${routeCounter}`,
    fromChainId: ChainId.TRN,
    toChainId: ChainId.TRN,
    fromAmount: step.action.fromAmount,
    fromAmountUSD: '0.3',
    fromToken: TRX_TOKEN,
    toToken: USDT_TOKEN,
    toAmount: step.estimate.toAmount,
    toAmountMin: step.estimate.toAmountMin,
    toAmountUSD: '0.3',
    fromAddress: WALLET_ADDRESS,
    toAddress: WALLET_ADDRESS,
    gasCostUSD: '0',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// Fake Tron node and LI.FI API
// ---------------------------------------------------------------------------

export interface FakeTronNetwork {
  /** Signed transactions received by `wallet/broadcasttransaction`, in order. */
  readonly broadcasts: SignedTransaction[]
  /** Every node endpoint that was called, in order. */
  readonly endpoints: string[]
  /** Node endpoints the fake does not implement (must stay empty). */
  readonly unsupported: string[]
  /** Included txIDs and their contract result (`'SUCCESS'`, `'REVERT'`, …). */
  readonly landed: Map<string, string>
  /** Contract result for the next newly included transaction. */
  failNext: string | undefined
  /** Requests to `/advanced/stepTransaction`. */
  stepTransactionRequests: number
  /** `'no-receiving'` makes `/status` answer DONE without `receiving`. */
  statusMode: 'done' | 'no-receiving'
  /** Called when a broadcast arrives, before the fake includes it. */
  onBroadcast?: (transaction: SignedTransaction) => void
  /** Forgets what the chain saw: the page closed before the broadcast. */
  forgetChain(): void
  /** Clears the call records, keeps the chain state. */
  clearRecords(): void
  /** Replacement for `HttpProvider.prototype.request`. */
  request(url: string, payload?: Record<string, unknown>): Promise<unknown>
  fetch: typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * What `GET /v1/status` answers for a hash LI.FI never saw (Task 0.3): HTTP
 * 404 with body code 1003, never a `NOT_FOUND` status. `isKnownToStatusApi`
 * reads it as "no information" (false); only an HTTP 200 answer vetoes
 * "dropped".
 */
const statusNotFound = (): Response =>
  json(
    { message: 'Transaction hash is not found in any chain.', code: 1003 },
    404
  )

const urlOf = (input: unknown): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : (input as Request).url

const block = () => {
  const timestamp = Date.now()
  return {
    blockID: `${'00'.repeat(4)}${'0003e8'.padStart(8, '0')}${'cd'.repeat(24)}`,
    block_header: { raw_data: { number: 1000, timestamp } },
  }
}

export const createFakeTronNetwork = (): FakeTronNetwork => {
  let quoteCounter = 0
  const stored = new Map<string, SignedTransaction>()
  const info = (txID: string) => {
    const result = network.landed.get(txID)
    return {
      id: txID,
      blockNumber: 1001,
      blockTimeStamp: Date.now(),
      contractResult: [''],
      ...(result !== 'SUCCESS' && { result: 'FAILED' }),
      receipt: { result, energy_usage_total: 1 },
    }
  }
  const network: FakeTronNetwork = {
    broadcasts: [],
    endpoints: [],
    unsupported: [],
    landed: new Map<string, string>(),
    failNext: undefined,
    stepTransactionRequests: 0,
    statusMode: 'done',
    onBroadcast: undefined,
    forgetChain() {
      network.landed.clear()
      stored.clear()
    },
    clearRecords() {
      network.broadcasts.length = 0
      network.endpoints.length = 0
      network.stepTransactionRequests = 0
    },
    async request(url, payload = {}) {
      const endpoint = url.replace(/^\//, '')
      network.endpoints.push(endpoint)
      switch (endpoint) {
        case 'wallet/getblock':
        case 'wallet/getnowblock':
        case 'walletsolidity/getblock':
        case 'walletsolidity/getnowblock':
        case 'wallet/getblockbynum':
        case 'walletsolidity/getblockbynum':
          return block()
        case 'wallet/getnodeinfo':
          return { configNodeInfo: { codeVersion: '4.8.0' } }
        case 'wallet/broadcasttransaction': {
          const transaction = structuredClone(payload) as SignedTransaction
          network.onBroadcast?.(transaction)
          network.broadcasts.push(transaction)
          if (network.landed.has(transaction.txID)) {
            return {
              result: false,
              code: 'DUP_TRANSACTION_ERROR',
              txid: transaction.txID,
              message: '4475702074726e73616374696f6e2e',
            }
          }
          network.landed.set(transaction.txID, network.failNext ?? 'SUCCESS')
          network.failNext = undefined
          stored.set(transaction.txID, transaction)
          return { result: true, txid: transaction.txID }
        }
        case 'wallet/gettransactioninfobyid':
        case 'walletsolidity/gettransactioninfobyid': {
          const txID = String(payload.value)
          return network.landed.has(txID) ? info(txID) : {}
        }
        case 'wallet/gettransactionbyid':
        case 'walletsolidity/gettransactionbyid': {
          const txID = String(payload.value)
          const transaction = stored.get(txID)
          return transaction
            ? {
                ...transaction,
                ret: [{ contractRet: network.landed.get(txID) }],
              }
            : {}
        }
        default:
          network.unsupported.push(endpoint)
          throw new Error(`Fake Tron node: ${endpoint} is not implemented`)
      }
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.startsWith(`${API_URL}/advanced/stepTransaction`)) {
        network.stepTransactionRequests += 1
        quoteCounter += 1
        const requested = JSON.parse(String(init?.body)) as LiFiStep
        return json({
          ...requested,
          transactionRequest: { data: `0x${buildRawDataHex(quoteCounter)}` },
        })
      }
      if (url.startsWith(`${API_URL}/status`)) {
        const txHash = new URL(url).searchParams.get('txHash') ?? ''
        // LI.FI knows a transaction only after it landed on the fake chain.
        if (!network.landed.has(txHash)) {
          return statusNotFound()
        }
        return json(statusAnswer(network.statusMode, txHash))
      }
      throw new Error(`Unexpected fetch in the reload spec: ${url}`)
    }) as typeof fetch,
  }
  return network
}

const statusAnswer = (mode: FakeTronNetwork['statusMode'], txHash: string) => {
  const sending = {
    txHash,
    txLink: `https://tronscan.test/#/transaction/${txHash}`,
    chainId: ChainId.TRN,
    amount: '1000000',
    token: TRX_TOKEN,
    gasPrice: '1',
    gasUsed: '1',
    gasToken: TRX_TOKEN,
    gasAmount: '1',
    gasAmountUSD: '0',
    timestamp: 1,
  }
  if (mode === 'no-receiving') {
    // `waitForTransactionStatus` throws `ServerError` for a status without
    // `receiving`; `WaitForTransactionStatusTask` wraps it without a final
    // marker. This is an unknown outcome after the transaction landed.
    return { status: 'DONE', substatus: 'COMPLETED', sending }
  }
  return {
    status: 'DONE',
    substatus: 'COMPLETED',
    tool: 'sunswap',
    sending,
    receiving: {
      txHash,
      txLink: `https://tronscan.test/#/transaction/${txHash}`,
      chainId: ChainId.TRN,
      amount: '300000',
      token: USDT_TOKEN,
      timestamp: 2,
    },
  }
}

// ---------------------------------------------------------------------------
// One "page": a wallet adapter, a provider and a client
// ---------------------------------------------------------------------------

export interface Page {
  client: SDKClient
  /** The adapter's `signTransaction`, spied. */
  signTransaction: Mock
}

export const openPage = (): Page => {
  const signTransaction = vi.fn(
    async (transaction: Transaction): Promise<SignedTransaction> => ({
      ...transaction,
      signature: [WALLET_SIGNATURE],
    })
  )
  const wallet = {
    address: WALLET_ADDRESS,
    signTransaction,
  } as unknown as Adapter

  const base = TronProvider({ getWallet: async () => wallet })
  const provider = {
    ...base,
    getBalance: async (
      _client: SDKClient,
      _walletAddress: string,
      tokens: Token[]
    ): Promise<TokenAmount[]> =>
      tokens.map((token) => ({ ...token, amount: 10n ** 30n })),
  } as unknown as SDKProvider

  const client = createClient({
    integrator: 'reload-specs',
    apiUrl: API_URL,
    preloadChains: false,
    disableVersionCheck: true,
    providers: [provider],
    rpcUrls: { [ChainId.TRN]: TRON_RPC_URLS },
  })
  client.setChains([TRON_CHAIN])
  return { client, signTransaction }
}

/** Widget persistence: what `updateRouteHook` wrote to storage. */
export const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

export const swapActionOf = (
  route: RouteExtended
): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')
