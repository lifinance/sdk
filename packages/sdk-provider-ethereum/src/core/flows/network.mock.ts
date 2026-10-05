/**
 * Network-level harness for the EVM money-path specs (`network*.flow.spec.ts`).
 *
 * The action-level harness (`harness.mock.ts`) replaces viem actions, so no
 * real viem action runs there. This one replaces nothing inside the SDK or
 * viem. A spec drives `executeRoute` / `resumeRoute` with the real
 * `EthereumStepExecutor`, the real tasks, the real viem actions and the real
 * `getPublicClient`; only the two network edges are fake:
 *
 * - **The wallet**: a viem wallet client with a local account
 *   (`privateKeyToAccount`, a throwaway key that is never funded anywhere)
 *   over a `custom` EIP-1193 transport. viem signs locally and sends
 *   `eth_sendRawTransaction`, so every signature and hash is real.
 * - **`globalThis.fetch`**: one dispatcher answers the JSON-RPC of the SDK's
 *   own public client, the LI.FI API and the Tenderly lookup the error parser
 *   makes after a revert. `getPublicClient` builds `http(url)` transports over
 *   the chain's RPC URLs, and viem's `http` reads the global `fetch` inside
 *   each request, so faking `fetch` reaches the transport the real code uses;
 *   `getPublicClient` itself is not mocked.
 *
 * Both edges answer from the same in-memory chains: a transaction the wallet
 * sends is mined at once, so the first `eth_getTransactionReceipt` finds it
 * (no receipt polling starts), the public client sees the new state, and the
 * fake `/status` knows the hash.
 *
 * ## Unknown requests
 *
 * The SDK swallows many read errors (`getAccountCode`, the batching probe,
 * `getAllowance`), so a throw alone cannot catch an unexpected call. Every
 * method, `eth_call` selector, transaction and URL the fake does not know
 * lands in {@link FakeNetwork.unknown}; every spec asserts it is empty in
 * `afterEach`. Errors use JSON-RPC codes viem does not retry (`-32601`,
 * `-32000`; `3` over HTTP), so viem adds no backoff sleep and no duplicate
 * record. (Over the wallet's `custom` transport viem turns a code it does
 * not know, such as `3`, into `UnknownRpcError` and retries it; only an
 * unknown `eth_call` on the wallet answers `3`, and it is recorded anyway.
 * The SDK's own balance check still retries a failed balance read, so a
 * failing `eth_getBalance` is recorded once per attempt.)
 *
 * ## Harness errors
 *
 * For the same reason, a throw inside the fake itself (a decode, a parameter
 * read, a body parse) must not vanish. Both entry points catch it and record
 * `harness error: <method or path> on <url>: <message>` in
 * {@link FakeNetwork.unknown}: the wallet's EIP-1193 `request` (its `<url>`
 * is `wallet:<chainId>`, a custom transport has none) answers it as JSON-RPC
 * error `-32000`, the public client's JSON-RPC over `fetch` answers it as
 * JSON-RPC error `-32000` per request, and any other `fetch` throw (the
 * LI.FI API, a body parse) is recorded, then rethrown. The deliberate
 * answers above (`RpcError`) pass through unrecorded.
 *
 * ## Isolation
 *
 * `getPublicClient` caches one client per chain id at module level, and the
 * cache is not exported. That is harmless here: each chain's RPC URL is a
 * constant and viem reads `fetch` per request, so a cached client reaches the
 * fake of the current test. Route ids, quote ids and account nonces come from
 * module counters, so every test signs different bytes and gets different
 * hashes (`TRANSACTION_HASH_OBSERVERS` and viem's receipt observers are keyed
 * by hash).
 *
 * `.mock.ts` keeps this file out of `dist` (tsdown entry, tsconfig exclude,
 * package.json `files`).
 */
import {
  ChainType,
  createClient,
  type ExecutionOptions,
  type ExtendedChain,
  executeRoute,
  type LiFiStep,
  type Route,
  type RouteExtended,
  resumeRoute,
  type SDKClient,
  type Token,
} from '@lifi/sdk'
import {
  type Address,
  type Chain,
  createWalletClient,
  custom,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Hash,
  type Hex,
  isAddressEqual,
  keccak256,
  numberToHex,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerializedEIP1559,
  toHex,
  type WalletClient,
  zeroAddress,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { EthereumProvider } from '../../EthereumProvider.js'
import { dedupeActionPairs } from './routeUpdates.mock.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

export const API_URL = 'https://api.lifi.test/v1'

export const SOURCE_CHAIN_ID = 137
export const DESTINATION_CHAIN_ID = 42161

export const RPC_URLS: Record<number, string> = {
  [SOURCE_CHAIN_ID]: 'https://rpc.polygon.test/',
  [DESTINATION_CHAIN_ID]: 'https://rpc.arbitrum.test/',
}

export const EXPLORER_URLS: Record<number, string> = {
  [SOURCE_CHAIN_ID]: 'https://polygonscan.test/',
  [DESTINATION_CHAIN_ID]: 'https://arbiscan.test/',
}

/**
 * Throwaway key, never funded on any chain. The wallet address is derived
 * from it because `checkClient` compares the signer to
 * `step.action.fromAddress`.
 */
const PRIVATE_KEY: Hex =
  '0x8d2f8c6b45a5d6b6a0e7c1b4f3e2d1c0b9a8f7e6d5c4b3a2918f7e6d5c4b3a29'

export const WALLET_ADDRESS: Address = privateKeyToAccount(PRIVATE_KEY).address

/** `step.estimate.approvalAddress` and the `to` of every quote. */
export const DIAMOND_ADDRESS: Address =
  '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

export const USDC_POLYGON: Address =
  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
export const USDT_POLYGON: Address =
  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
export const USDC_ARBITRUM: Address =
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'

/** The wallet's starting balances on every fake chain. */
export const START_NATIVE_BALANCE: bigint = 10n ** 21n
export const START_TOKEN_BALANCE: bigint = 10n ** 12n

/** Gas and fee answers. No spec pins them (spec §3.5). */
const BASE_FEE = 30_000_000_000n
const PRIORITY_FEE = 1_500_000_000n
const GAS_ESTIMATE = 100_000n
const START_BLOCK = 50_000_000n

const buildToken = (
  chainId: number,
  address: Address,
  symbol: string,
  decimals: number
): Token =>
  ({
    address,
    chainId,
    symbol,
    decimals,
    name: symbol,
    priceUSD: '1',
    coinKey: symbol,
    logoURI: '',
  }) as unknown as Token

export const POL: Token = buildToken(SOURCE_CHAIN_ID, zeroAddress, 'POL', 18)
export const USDC: Token = buildToken(SOURCE_CHAIN_ID, USDC_POLYGON, 'USDC', 6)
export const USDT: Token = buildToken(SOURCE_CHAIN_ID, USDT_POLYGON, 'USDT', 6)
export const USDC_ARB: Token = buildToken(
  DESTINATION_CHAIN_ID,
  USDC_ARBITRUM,
  'USDC',
  6
)
const ETH_ARB: Token = buildToken(DESTINATION_CHAIN_ID, zeroAddress, 'ETH', 18)

/**
 * A LI.FI chain without `permit2`, `permit2Proxy` and `multicallAddress`.
 * Without the two Permit2 contracts the ERC-20 lane is the classic one:
 * approve the diamond for the amount, then send the swap to the diamond.
 * Without a multicall address `getEthereumBalance` reads one balance per
 * call.
 */
const buildChain = (
  id: number,
  name: string,
  nativeToken: Token
): ExtendedChain =>
  ({
    id,
    key: name.toLowerCase(),
    chainType: ChainType.EVM,
    name,
    coin: nativeToken.symbol,
    mainnet: true,
    logoURI: '',
    diamondAddress: DIAMOND_ADDRESS,
    nativeToken,
    metamask: {
      chainId: numberToHex(id),
      chainName: name,
      nativeCurrency: {
        name: nativeToken.symbol,
        symbol: nativeToken.symbol,
        decimals: 18,
      },
      rpcUrls: [RPC_URLS[id]],
      blockExplorerUrls: [EXPLORER_URLS[id]],
    },
  }) as unknown as ExtendedChain

export const SOURCE_CHAIN: ExtendedChain = buildChain(
  SOURCE_CHAIN_ID,
  'Polygon',
  POL
)
export const DESTINATION_CHAIN: ExtendedChain = buildChain(
  DESTINATION_CHAIN_ID,
  'Arbitrum',
  ETH_ARB
)

// ---------------------------------------------------------------------------
// The fake diamond: what a quote's calldata does on the fake chain
// ---------------------------------------------------------------------------

/**
 * Not the LI.FI diamond ABI: two plain entry points the fake chain can
 * execute. `quoteId` makes the calldata of every quote, and so every signed
 * transaction, unique. The diamond pulls `fromAmount` from the sender: the
 * native value must equal it, or the ERC-20 allowance and balance must cover
 * it, else the transaction reverts (receipt status `0x0`).
 */
const fakeDiamondAbi = parseAbi([
  'function swap(bytes32 quoteId, address fromToken, uint256 fromAmount, address toToken) payable',
  'function bridge(bytes32 quoteId, address fromToken, uint256 fromAmount, uint256 toChainId) payable',
])

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
])

// ---------------------------------------------------------------------------
// Steps and routes
// ---------------------------------------------------------------------------

export interface NetworkStepOptions {
  id: string
  fromToken: Token
  toToken: Token
  fromAmount: string
  toAmount: string
  /** The swap tool or bridge key; `/status` is asked with it. */
  tool: string
}

/**
 * A step as `/v1/advanced/routes` returns it: no `transactionRequest`, so the
 * SDK fetches one from `/advanced/stepTransaction`.
 */
export const buildNetworkStep = (options: NetworkStepOptions): LiFiStep =>
  ({
    id: options.id,
    type: 'lifi',
    tool: options.tool,
    toolDetails: { key: options.tool, name: options.tool, logoURI: '' },
    action: {
      fromChainId: options.fromToken.chainId,
      toChainId: options.toToken.chainId,
      fromToken: options.fromToken,
      toToken: options.toToken,
      fromAmount: options.fromAmount,
      slippage: 0.005,
      fromAddress: WALLET_ADDRESS,
      toAddress: WALLET_ADDRESS,
    },
    estimate: {
      tool: options.tool,
      fromAmount: options.fromAmount,
      fromAmountUSD: '1',
      toAmount: options.toAmount,
      toAmountMin: options.toAmount,
      toAmountUSD: '1',
      approvalAddress: DIAMOND_ADDRESS,
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
    },
    // Must exist and must contain no `custom` step, or `isContractCallStep`
    // reroutes the re-quote to `getContractCallsQuote`.
    includedSteps: [],
  }) as unknown as LiFiStep

let routeCounter = 0

/** A route over `steps` with a unique id (execution state is keyed by it). */
export const buildNetworkRoute = (steps: LiFiStep[]): Route => {
  routeCounter += 1
  const first = steps[0]
  const last = steps[steps.length - 1]
  return {
    id: `network-route-${routeCounter}`,
    fromChainId: first.action.fromChainId,
    toChainId: last.action.toChainId,
    fromToken: first.action.fromToken,
    toToken: last.action.toToken,
    fromAmount: first.action.fromAmount,
    fromAmountUSD: '1',
    toAmount: last.estimate.toAmount,
    toAmountMin: last.estimate.toAmountMin,
    toAmountUSD: '1',
    fromAddress: WALLET_ADDRESS,
    toAddress: WALLET_ADDRESS,
    gasCostUSD: '0.01',
    steps,
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// The fake network
// ---------------------------------------------------------------------------

/** One JSON-RPC request, from the wallet transport or the public client. */
export interface RpcCall {
  via: 'wallet' | 'public'
  chainId: number
  method: string
}

/** One request to the LI.FI API. */
export interface ApiCall {
  /** Path below `/v1`, e.g. `/advanced/stepTransaction`. */
  path: string
  /** Search params of a GET. */
  query: Record<string, string>
  /** Parsed JSON body of a POST. */
  body?: LiFiStep
}

/** One `/advanced/stepTransaction` answer. */
export interface Quote {
  quoteId: Hex
  /** The step the SDK posted. */
  requested: LiFiStep
  /** The `transactionRequest` the fake API answered with. */
  transactionRequest: { to: Address; data: Hex; value: Hex; chainId: number }
}

/** A transaction as the wallet's local account signed it, decoded. */
export interface SignedTransaction {
  serialized: Hex
  hash: Hash
  chainId: number | undefined
  to: Address | undefined
  data: Hex | undefined
  /** `0n` when the transaction carries no value. */
  value: bigint
}

export interface FakeNetwork {
  /** Every JSON-RPC method that reached the fake, in order. */
  readonly rpc: RpcCall[]
  /** Every LI.FI API request, in order. */
  readonly api: ApiCall[]
  /** Every `/advanced/stepTransaction` answer, in order. */
  readonly quotes: Quote[]
  /** What the wallet's local account signed, in order. */
  readonly signed: SignedTransaction[]
  /** Typed data and messages the local account signed (none expected). */
  readonly signedMessages: string[]
  /** Raw transactions that reached `eth_sendRawTransaction`, in order. */
  readonly broadcast: Hex[]
  /** Transaction hashes the error parser looked up on Tenderly. */
  readonly tenderly: string[]
  /** Unknown methods, selectors, transactions and URLs. Must stay empty. */
  readonly unknown: string[]
  /** The next transaction mined on any chain reverts (receipt status `0x0`). */
  revertNext: boolean
  /** The ERC-20 allowance on the source chain now. */
  allowance(token: Address, owner: Address, spender: Address): bigint
  /** The ERC-20 balance on the source chain now. */
  balanceOf(token: Address, owner: Address): bigint
  /** The native balance on a chain now. */
  nativeBalanceOf(chainId: number, owner: Address): bigint
  /** The receipt status of a mined transaction, `undefined` if unknown. */
  receiptStatus(hash: Hash): 'success' | 'reverted' | undefined
  /** Install with `vi.stubGlobal('fetch', network.fetch)`. */
  readonly fetch: typeof fetch
  /** The wallet transport's EIP-1193 `request`, on the wallet's chain. */
  walletRequest(
    chainId: number,
    args: { method: string; params?: unknown }
  ): Promise<unknown>
}

export interface FakeNetworkOptions {
  /** ERC-20 allowance the wallet already gave the diamond, per token. */
  allowances?: { token: Address; amount: bigint }[]
  /**
   * `receiving.amount` of `/status`, i.e. the step's `execution.toAmount`.
   * Defaults to the quoted `estimate.toAmount`.
   */
  receivedAmount?: (quote: LiFiStep) => string
}

interface MinedTransaction {
  hash: Hash
  from: Address
  to: Address
  nonce: number
  value: bigint
  data: Hex
  gas: bigint
  blockNumber: bigint
  success: boolean
}

interface FakeChain {
  id: number
  blockNumber: bigint
  /** `${owner}` → native balance. */
  native: Map<string, bigint>
  /** `${token}:${owner}` → ERC-20 balance. */
  balances: Map<string, bigint>
  /** `${token}:${owner}:${spender}` → ERC-20 allowance. */
  allowances: Map<string, bigint>
  nonces: Map<string, number>
  mined: Map<string, MinedTransaction>
}

class RpcError extends Error {
  readonly code: number
  readonly data?: Hex
  constructor(code: number, message: string, data?: Hex) {
    super(message)
    this.code = code
    this.data = data
  }
}

const mapKey = (...parts: string[]): string =>
  parts.map((part) => part.toLowerCase()).join(':')

/**
 * Nonces start from a module counter so that two tests in one file never
 * sign the same bytes, even for an identical approval.
 */
let nonceSeed = 0
let quoteCounter = 0

const createFakeChain = (id: number): FakeChain => {
  nonceSeed += 10
  return {
    id,
    blockNumber: START_BLOCK,
    native: new Map([[mapKey(WALLET_ADDRESS), START_NATIVE_BALANCE]]),
    balances: new Map([
      [mapKey(USDC_POLYGON, WALLET_ADDRESS), START_TOKEN_BALANCE],
      [mapKey(USDT_POLYGON, WALLET_ADDRESS), START_TOKEN_BALANCE],
    ]),
    allowances: new Map(),
    nonces: new Map([[mapKey(WALLET_ADDRESS), nonceSeed]]),
    mined: new Map(),
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const urlOf = (input: unknown): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : (input as Request).url

/** The bridge's (fake) destination transaction for a source transaction. */
export const destinationHashOf = (sourceHash: Hash): Hash =>
  keccak256(`${sourceHash}d0`)

const ZERO_32: Hex = `0x${'00'.repeat(32)}`

export const createFakeNetwork = (
  options: FakeNetworkOptions = {}
): FakeNetwork => {
  const chains = new Map<number, FakeChain>([
    [SOURCE_CHAIN_ID, createFakeChain(SOURCE_CHAIN_ID)],
    [DESTINATION_CHAIN_ID, createFakeChain(DESTINATION_CHAIN_ID)],
  ])
  const chainOf = (chainId: number): FakeChain => {
    const chain = chains.get(chainId)
    if (!chain) {
      throw new RpcError(-32601, `The fake network has no chain ${chainId}.`)
    }
    return chain
  }
  const source = chainOf(SOURCE_CHAIN_ID)
  for (const { token, amount } of options.allowances ?? []) {
    source.allowances.set(
      mapKey(token, WALLET_ADDRESS, DIAMOND_ADDRESS),
      amount
    )
  }
  const quotesById = new Map<Hex, LiFiStep>()

  const network: FakeNetwork = {
    rpc: [],
    api: [],
    quotes: [],
    signed: [],
    signedMessages: [],
    broadcast: [],
    tenderly: [],
    unknown: [],
    revertNext: false,
    allowance: (token, owner, spender) =>
      source.allowances.get(mapKey(token, owner, spender)) ?? 0n,
    balanceOf: (token, owner) =>
      source.balances.get(mapKey(token, owner)) ?? 0n,
    nativeBalanceOf: (chainId, owner) =>
      chainOf(chainId).native.get(mapKey(owner)) ?? 0n,
    receiptStatus: (hash) => {
      for (const chain of chains.values()) {
        const mined = chain.mined.get(hash.toLowerCase())
        if (mined) {
          return mined.success ? 'success' : 'reverted'
        }
      }
      return undefined
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      try {
        return await answerFetch(url, init)
      } catch (error) {
        const what = url.startsWith(API_URL)
          ? url.slice(API_URL.length).split('?')[0]
          : 'fetch'
        recordHarnessError(what, url, error)
        throw error
      }
    }) as typeof fetch,
    walletRequest: async (chainId, { method, params }) => {
      network.rpc.push({ via: 'wallet', chainId, method })
      return answerRpcAt(
        `wallet:${chainId}`,
        chainId,
        method,
        (params ?? []) as unknown[]
      )
    },
  }

  /** Records a throw inside the fake itself (see "Harness errors"). */
  const recordHarnessError = (
    what: string,
    where: string,
    error: unknown
  ): string => {
    const message = error instanceof Error ? error.message : String(error)
    network.unknown.push(`harness error: ${what} on ${where}: ${message}`)
    return message
  }

  /**
   * {@link answerRpc} at one entry point: a deliberate `RpcError` passes
   * through; any other throw is a harness error, answered as `-32000`, a
   * code viem does not retry.
   */
  const answerRpcAt = async (
    where: string,
    chainId: number,
    method: string,
    params: unknown[]
  ): Promise<unknown> => {
    try {
      return await answerRpc(chainId, method, params)
    } catch (error) {
      if (error instanceof RpcError) {
        throw error
      }
      const message = recordHarnessError(method, where, error)
      throw new RpcError(-32000, `harness error: ${message}`)
    }
  }

  const answerFetch = async (
    url: string,
    init: RequestInit | undefined
  ): Promise<Response> => {
    for (const [chainId, rpcUrl] of Object.entries(RPC_URLS)) {
      if (url.startsWith(rpcUrl)) {
        return answerHttpRpc(Number(chainId), rpcUrl, String(init?.body))
      }
    }
    if (url.startsWith(API_URL)) {
      return answerApi(new URL(url), init)
    }
    const tenderly = url.match(
      /^https:\/\/api\.tenderly\.co\/api\/v1\/public-contract\/\d+\/tx\/(0x[0-9a-f]+)$/
    )
    if (tenderly) {
      network.tenderly.push(tenderly[1])
      // Not an out-of-gas revert, so the parser keeps `TransactionFailed`.
      return json({ error_message: 'execution reverted' })
    }
    network.unknown.push(`fetch ${url}`)
    return json({ message: 'Unknown URL in the network fake.' }, 404)
  }

  /** viem's `http` transport batches: a body can be an array. */
  const answerHttpRpc = async (
    chainId: number,
    rpcUrl: string,
    body: string
  ): Promise<Response> => {
    type Request = { id: number; method: string; params?: unknown[] }
    const parsed = JSON.parse(body) as Request | Request[]
    const requests = Array.isArray(parsed) ? parsed : [parsed]
    const answers = await Promise.all(
      requests.map(async (request) => {
        network.rpc.push({ via: 'public', chainId, method: request.method })
        try {
          const result = await answerRpcAt(
            rpcUrl,
            chainId,
            request.method,
            request.params ?? []
          )
          return { jsonrpc: '2.0', id: request.id, result }
        } catch (error) {
          // `answerRpcAt` throws only `RpcError`.
          const { code, message, data } = error as RpcError
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code, message, data },
          }
        }
      })
    )
    return json(Array.isArray(parsed) ? answers : answers[0])
  }

  const blockHashOf = (chainId: number, number: bigint): Hash =>
    keccak256(toHex(`block:${chainId}:${number}`))

  /**
   * The head block. Empty, so `getMaxPriorityFeePerGas` finds no tip to
   * average, returns `undefined`, and viem asks `eth_maxPriorityFeePerGas`.
   */
  const headBlock = (chain: FakeChain) => ({
    number: numberToHex(chain.blockNumber),
    hash: blockHashOf(chain.id, chain.blockNumber),
    parentHash: blockHashOf(chain.id, chain.blockNumber - 1n),
    timestamp: numberToHex(1_700_000_000n + chain.blockNumber),
    baseFeePerGas: numberToHex(BASE_FEE),
    gasLimit: numberToHex(30_000_000n),
    gasUsed: '0x0',
    miner: zeroAddress,
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    logsBloom: `0x${'00'.repeat(256)}`,
    mixHash: ZERO_32,
    receiptsRoot: ZERO_32,
    sha3Uncles: ZERO_32,
    stateRoot: ZERO_32,
    transactionsRoot: ZERO_32,
    size: '0x0',
    uncles: [],
    transactions: [],
  })

  const transactionOf = (mined: MinedTransaction, chainId: number) => ({
    hash: mined.hash,
    nonce: numberToHex(mined.nonce),
    blockHash: blockHashOf(chainId, mined.blockNumber),
    blockNumber: numberToHex(mined.blockNumber),
    transactionIndex: '0x0',
    from: mined.from,
    to: mined.to,
    value: numberToHex(mined.value),
    gas: numberToHex(mined.gas),
    maxFeePerGas: numberToHex(BASE_FEE * 2n),
    maxPriorityFeePerGas: numberToHex(PRIORITY_FEE),
    input: mined.data,
    type: '0x2',
    chainId: numberToHex(chainId),
    accessList: [],
    v: '0x0',
    r: `0x${'11'.repeat(32)}`,
    s: `0x${'22'.repeat(32)}`,
    yParity: '0x0',
  })

  const receiptOf = (mined: MinedTransaction, chainId: number) => ({
    transactionHash: mined.hash,
    transactionIndex: '0x0',
    blockHash: blockHashOf(chainId, mined.blockNumber),
    blockNumber: numberToHex(mined.blockNumber),
    from: mined.from,
    to: mined.to,
    cumulativeGasUsed: numberToHex(GAS_ESTIMATE),
    gasUsed: numberToHex(GAS_ESTIMATE),
    effectiveGasPrice: numberToHex(BASE_FEE + PRIORITY_FEE),
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: mined.success ? '0x1' : '0x0',
    type: '0x2',
  })

  /** Runs a transaction against the in-memory state; `false` reverts it. */
  const execute = (
    chain: FakeChain,
    from: Address,
    to: Address,
    value: bigint,
    data: Hex
  ): boolean => {
    const nativeKey = mapKey(from)
    const native = chain.native.get(nativeKey) ?? 0n
    if (native < value) {
      return false
    }
    if (isAddressEqual(to, DIAMOND_ADDRESS)) {
      const { args } = decodeFunctionData({ abi: fakeDiamondAbi, data })
      const [, fromToken, fromAmount] = args
      if (fromToken === zeroAddress) {
        if (value !== fromAmount) {
          return false
        }
        chain.native.set(nativeKey, native - value)
        return true
      }
      const balanceKey = mapKey(fromToken, from)
      const allowanceKey = mapKey(fromToken, from, DIAMOND_ADDRESS)
      const balance = chain.balances.get(balanceKey) ?? 0n
      const allowance = chain.allowances.get(allowanceKey) ?? 0n
      if (balance < fromAmount || allowance < fromAmount) {
        return false
      }
      chain.balances.set(balanceKey, balance - fromAmount)
      chain.allowances.set(allowanceKey, allowance - fromAmount)
      return true
    }
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data })
    if (functionName !== 'approve') {
      network.unknown.push(`transaction ${to} ${functionName}`)
      return false
    }
    const [spender, amount] = args
    chain.allowances.set(mapKey(to, from, spender), amount)
    return true
  }

  /** `eth_call`: the ERC-20 reads the SDK makes. Anything else reverts. */
  const answerCall = (chain: FakeChain, to: Address, data: Hex): Hex => {
    let decoded: ReturnType<typeof decodeFunctionData<typeof erc20Abi>>
    try {
      decoded = decodeFunctionData({ abi: erc20Abi, data })
    } catch {
      network.unknown.push(`eth_call ${to} ${data.slice(0, 10)}`)
      throw new RpcError(3, 'execution reverted', '0x')
    }
    if (decoded.functionName === 'allowance') {
      const [owner, spender] = decoded.args
      return numberToHex(
        chain.allowances.get(mapKey(to, owner, spender)) ?? 0n,
        { size: 32 }
      )
    }
    if (decoded.functionName === 'balanceOf') {
      const [owner] = decoded.args
      return numberToHex(chain.balances.get(mapKey(to, owner)) ?? 0n, {
        size: 32,
      })
    }
    network.unknown.push(`eth_call ${to} ${decoded.functionName}`)
    throw new RpcError(3, 'execution reverted', '0x')
  }

  const sendRawTransaction = async (
    chain: FakeChain,
    raw: Hex
  ): Promise<Hash> => {
    network.broadcast.push(raw)
    const transaction = parseTransaction(raw)
    const from = await recoverTransactionAddress({
      serializedTransaction: raw as TransactionSerializedEIP1559,
    })
    const nonce = chain.nonces.get(mapKey(from)) ?? 0
    if (transaction.chainId !== chain.id) {
      throw new RpcError(-32000, 'invalid chain id for signer')
    }
    if (transaction.nonce !== nonce) {
      throw new RpcError(-32000, `invalid nonce: expected ${nonce}`)
    }
    const hash = keccak256(raw)
    const to = transaction.to as Address
    const value = transaction.value ?? 0n
    const data = transaction.data ?? '0x'
    chain.nonces.set(mapKey(from), nonce + 1)
    chain.blockNumber += 1n
    const success = !network.revertNext && execute(chain, from, to, value, data)
    network.revertNext = false
    chain.mined.set(hash, {
      hash,
      from,
      to,
      nonce,
      value,
      data,
      gas: transaction.gas ?? 0n,
      blockNumber: chain.blockNumber,
      success,
    })
    return hash
  }

  const answerRpc = async (
    chainId: number,
    method: string,
    params: unknown[]
  ): Promise<unknown> => {
    const chain = chainOf(chainId)
    switch (method) {
      case 'eth_chainId':
        return numberToHex(chainId)
      case 'eth_blockNumber':
        return numberToHex(chain.blockNumber)
      case 'eth_getBlockByNumber':
        return headBlock(chain)
      case 'eth_maxPriorityFeePerGas':
        return numberToHex(PRIORITY_FEE)
      case 'eth_estimateGas':
        return numberToHex(GAS_ESTIMATE)
      case 'eth_getTransactionCount': {
        const [address] = params as [Address]
        return numberToHex(chain.nonces.get(mapKey(address)) ?? 0)
      }
      case 'eth_getBalance': {
        const [address] = params as [Address]
        return numberToHex(chain.native.get(mapKey(address)) ?? 0n)
      }
      case 'eth_getCode':
        // The only account the SDK asks about is the wallet: an EOA.
        return '0x'
      case 'eth_call': {
        const [request] = params as [{ to: Address; data?: Hex; input?: Hex }]
        return answerCall(
          chain,
          request.to,
          request.data ?? request.input ?? '0x'
        )
      }
      case 'eth_sendRawTransaction':
        return sendRawTransaction(chain, (params as [Hex])[0])
      case 'eth_getTransactionReceipt': {
        const mined = chain.mined.get((params as [Hash])[0].toLowerCase())
        return mined ? receiptOf(mined, chainId) : null
      }
      case 'eth_getTransactionByHash': {
        const mined = chain.mined.get((params as [Hash])[0].toLowerCase())
        return mined ? transactionOf(mined, chainId) : null
      }
      // A plain node: viem falls back to the individual fee, nonce and gas
      // calls when `eth_fillTransaction` is missing, and a local account
      // behind a node has no EIP-5792, so the SDK takes the standard
      // (unbatched) strategy.
      case 'eth_fillTransaction':
      case 'wallet_getCapabilities':
        throw new RpcError(-32601, `the method ${method} does not exist`)
      default:
        network.unknown.push(`rpc ${method}`)
        throw new RpcError(-32601, `the method ${method} does not exist`)
    }
  }

  const answerStepTransaction = (requested: LiFiStep): Response => {
    quoteCounter += 1
    const quoteId = keccak256(toHex(`quote:${quoteCounter}`))
    quotesById.set(quoteId, requested)
    const { fromToken, toToken, fromAmount, fromChainId, toChainId } =
      requested.action
    const data =
      fromChainId === toChainId
        ? encodeFunctionData({
            abi: fakeDiamondAbi,
            functionName: 'swap',
            args: [
              quoteId,
              getAddress(fromToken.address),
              BigInt(fromAmount),
              getAddress(toToken.address),
            ],
          })
        : encodeFunctionData({
            abi: fakeDiamondAbi,
            functionName: 'bridge',
            args: [
              quoteId,
              getAddress(fromToken.address),
              BigInt(fromAmount),
              BigInt(toChainId),
            ],
          })
    const transactionRequest = {
      chainId: fromChainId,
      to: DIAMOND_ADDRESS,
      data,
      value:
        fromToken.address === zeroAddress
          ? numberToHex(BigInt(fromAmount))
          : '0x0',
    }
    network.quotes.push({ quoteId, requested, transactionRequest })
    return json({
      ...requested,
      transactionRequest: {
        ...transactionRequest,
        from: requested.action.fromAddress,
        gasLimit: numberToHex(500_000n),
        gasPrice: numberToHex(BASE_FEE),
      },
    })
  }

  /** `/status` knows a transaction once the fake chain mined it. */
  const answerStatus = (url: URL): Response => {
    const txHash = (url.searchParams.get('txHash') ?? '').toLowerCase()
    const fromChain = Number(url.searchParams.get('fromChain'))
    const mined = chains.get(fromChain)?.mined.get(txHash)
    const quoteId = mined
      ? (decodeFunctionData({ abi: fakeDiamondAbi, data: mined.data })
          .args[0] as Hex)
      : undefined
    const quote = quoteId ? quotesById.get(quoteId) : undefined
    if (!mined || !quote) {
      network.unknown.push(`status ${txHash}`)
      return json(
        { message: 'Transaction hash is not found in any chain.', code: 1003 },
        404
      )
    }
    const sending = {
      txHash: mined.hash,
      txLink: `${EXPLORER_URLS[fromChain]}tx/${mined.hash}`,
      chainId: fromChain,
      amount: quote.action.fromAmount,
      token: quote.action.fromToken,
      gasPrice: (BASE_FEE + PRIORITY_FEE).toString(),
      gasUsed: GAS_ESTIMATE.toString(),
      gasToken: POL,
      gasAmount: ((BASE_FEE + PRIORITY_FEE) * GAS_ESTIMATE).toString(),
      gasAmountUSD: '0.01',
      timestamp: 1_700_000_000,
    }
    if (!mined.success) {
      return json({
        transactionId: quoteId,
        status: 'FAILED',
        substatus: 'UNKNOWN_ERROR',
        tool: quote.tool,
        sending,
      })
    }
    const toChainId = quote.action.toChainId
    const sameChain = quote.action.fromChainId === toChainId
    const receivingHash = sameChain ? mined.hash : destinationHashOf(mined.hash)
    return json({
      transactionId: quoteId,
      status: 'DONE',
      substatus: 'COMPLETED',
      substatusMessage: 'The transfer is complete.',
      tool: quote.tool,
      lifiExplorerLink: `https://scan.lifi.test/tx/${mined.hash}`,
      ...(!sameChain && {
        bridgeExplorerLink: `https://bridge.test/tx/${mined.hash}`,
      }),
      sending,
      receiving: {
        txHash: receivingHash,
        txLink: `${EXPLORER_URLS[toChainId]}tx/${receivingHash}`,
        chainId: toChainId,
        amount: options.receivedAmount?.(quote) ?? quote.estimate.toAmount,
        token: quote.action.toToken,
        timestamp: 1_700_000_060,
      },
    })
  }

  const answerApi = (url: URL, init: RequestInit | undefined): Response => {
    const path = url.pathname.replace(/^\/v1/, '')
    const body =
      init?.method === 'POST'
        ? (JSON.parse(String(init.body)) as LiFiStep)
        : undefined
    network.api.push({
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      ...(body && { body }),
    })
    if (path === '/advanced/stepTransaction' && body) {
      return answerStepTransaction(body)
    }
    if (path === '/status') {
      return answerStatus(url)
    }
    network.unknown.push(`api ${path}`)
    return json({ message: 'Unknown LI.FI endpoint in the network fake.' }, 404)
  }

  return network
}

// ---------------------------------------------------------------------------
// One page: a wallet, a provider and an SDK client
// ---------------------------------------------------------------------------

export interface NetworkPageOptions {
  network: FakeNetwork
  route: Route
  /** `executeInBackground` of the first `executeRoute`. */
  executeInBackground?: boolean
}

export interface NetworkPage {
  readonly client: SDKClient
  /** Every route the consumer saw, cloned inside `updateRouteHook`. */
  readonly snapshots: RouteExtended[]
  /** Chain ids the SDK asked the wallet to switch to (none expected). */
  readonly switches: number[]
  /** `executeRoute`. */
  run(): Promise<RouteExtended>
  /** `executeRoute`, expecting a rejection; returns the error. */
  runExpectingFailure(): Promise<Error>
  /** "Try again": `resumeRoute` in the foreground with the route last seen. */
  retry(): Promise<RouteExtended>
  /** The live route the consumer last saw. */
  latest(): RouteExtended
}

/** The local account, recording what it signs before it hands it back. */
const recordingAccount = (network: FakeNetwork): PrivateKeyAccount => {
  const account = privateKeyToAccount(PRIVATE_KEY)
  return {
    ...account,
    async signTransaction(transaction, options) {
      const serialized = await account.signTransaction(transaction, options)
      const parsed = parseTransaction(serialized)
      network.signed.push({
        serialized,
        hash: keccak256(serialized),
        chainId: parsed.chainId,
        to: parsed.to ? getAddress(parsed.to) : undefined,
        data: parsed.data,
        value: parsed.value ?? 0n,
      })
      return serialized
    },
    async signTypedData(typedData) {
      network.signedMessages.push(`typedData:${String(typedData.primaryType)}`)
      return account.signTypedData(typedData)
    },
    async signMessage(message) {
      network.signedMessages.push('message')
      return account.signMessage(message)
    },
  } as PrivateKeyAccount
}

const viemChainOf = (chain: ExtendedChain): Chain => ({
  id: chain.id,
  name: chain.name,
  nativeCurrency: chain.metamask.nativeCurrency,
  rpcUrls: { default: { http: chain.metamask.rpcUrls } },
})

export const openNetworkPage = (options: NetworkPageOptions): NetworkPage => {
  const { network } = options
  const account = recordingAccount(network)
  const switches: number[] = []
  const walletOn = (chain: ExtendedChain): WalletClient =>
    createWalletClient({
      account,
      chain: viemChainOf(chain),
      transport: custom({
        request: (args) => network.walletRequest(chain.id, args),
      }),
    })
  let walletClient = walletOn(SOURCE_CHAIN)

  const provider = EthereumProvider({
    getWalletClient: async () => walletClient,
    switchChain: async (chainId: number) => {
      switches.push(chainId)
      walletClient = walletOn(
        chainId === DESTINATION_CHAIN_ID ? DESTINATION_CHAIN : SOURCE_CHAIN
      )
      return walletClient
    },
  })

  const client = createClient({
    integrator: 'network-flow-specs',
    apiUrl: API_URL,
    preloadChains: false,
    disableVersionCheck: true,
    providers: [provider],
    rpcUrls: {
      [SOURCE_CHAIN_ID]: [RPC_URLS[SOURCE_CHAIN_ID]],
      [DESTINATION_CHAIN_ID]: [RPC_URLS[DESTINATION_CHAIN_ID]],
    },
  })
  client.setChains([SOURCE_CHAIN, DESTINATION_CHAIN])

  const snapshots: RouteExtended[] = []
  let live: RouteExtended | undefined
  const executionOptions = (
    executeInBackground?: boolean
  ): ExecutionOptions => ({
    updateRouteHook: (route: RouteExtended) => {
      live = route
      snapshots.push(JSON.parse(JSON.stringify(route)))
    },
    ...(executeInBackground !== undefined && { executeInBackground }),
  })
  const latest = (): RouteExtended => {
    if (!live) {
      throw new Error('The route hook never fired; nothing was executed.')
    }
    return live
  }

  return {
    client,
    snapshots,
    switches,
    run: () =>
      executeRoute(
        client,
        options.route,
        executionOptions(options.executeInBackground)
      ),
    async runExpectingFailure(): Promise<Error> {
      try {
        await executeRoute(
          client,
          options.route,
          executionOptions(options.executeInBackground)
        )
      } catch (error) {
        return error as Error
      }
      throw new Error('Expected the route execution to fail, but it succeeded.')
    },
    retry: () => resumeRoute(client, latest(), executionOptions(false)),
    latest,
  }
}

// ---------------------------------------------------------------------------
// What the consumer saw
// ---------------------------------------------------------------------------

/**
 * The §4.2.2 sequence of one step (see `routeUpdates.mock.ts`), from the
 * snapshots of {@link NetworkPage.snapshots}, which are copied through JSON
 * inside `updateRouteHook`. `fromSnapshot` reads one leg of a run that was
 * retried: the leg starts from the last snapshot before `fromSnapshot`, i.e.
 * from what the consumer saw last, not from an empty step.
 */
export const actionSequence = (
  snapshots: RouteExtended[],
  stepIndex = 0,
  fromSnapshot = 0
): string[] => {
  const fires = snapshots.map((route) =>
    (route.steps[stepIndex]?.execution?.actions ?? []).map(
      (action) => `${action.type}:${action.status}`
    )
  )
  return dedupeActionPairs(fires.slice(fromSnapshot), fires[fromSnapshot - 1])
}

/** The money fields of a signed transaction: what the wallet authorised. */
export const moneyFields = (
  transaction: SignedTransaction
): Pick<SignedTransaction, 'chainId' | 'to' | 'data' | 'value'> => ({
  chainId: transaction.chainId,
  to: transaction.to,
  data: transaction.data,
  value: transaction.value,
})

/** A fake-diamond call, decoded. */
export const decodeDiamondCall = (
  data: Hex
): { functionName: string; args: readonly unknown[] } => {
  const { functionName, args } = decodeFunctionData({
    abi: fakeDiamondAbi,
    data,
  })
  return { functionName, args }
}

/** An ERC-20 `approve`, decoded. */
export const decodeApprove = (
  data: Hex
): { spender: Address; amount: bigint } => {
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data })
  if (functionName !== 'approve') {
    throw new Error(`Expected an approve call, got ${functionName}.`)
  }
  const [spender, amount] = args
  return { spender, amount }
}
