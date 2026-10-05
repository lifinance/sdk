/**
 * Network-level harness for the Tron money-path flow specs
 * (`*.flow.spec.ts` beside this file).
 *
 * The specs drive the real consumer entry points (`executeRoute`,
 * `resumeRoute`) through the real `TronProvider`, `TronStepExecutor`, task
 * pipeline and `TronWeb` instances. Nothing in the pipeline is replaced. The
 * fakes sit at the network boundary:
 *
 * - Tron node: `providers.HttpProvider.prototype.request` from `tronweb`.
 *   Every TronWeb call to a full node or a solidity node ends there (TronWeb
 *   uses axios, not `fetch`). {@link FakeTronNetwork} answers the endpoints
 *   the money paths call, from an in-memory chain (TRX and TRC-20 balances,
 *   allowances, landed transactions), and records every other request in
 *   `unknown`.
 * - Wallet: a TronLink-style `Adapter` whose `signTransaction` signs with a
 *   real throwaway key through TronWeb, so txIDs and signatures are real. It
 *   records every request and can reject like TronLink does.
 * - LI.FI API: `globalThis.fetch` (`/advanced/stepTransaction`, `/status`).
 *
 * Every quote carries a real `raw_data_hex` built with TronWeb, with a call
 * data nonce that is unique in the file, so every test has its own txIDs.
 *
 * `.mock.ts` keeps this file out of `dist` (tsdown, `package.json#files` and
 * `tsconfig.json#exclude` all skip it).
 */
import {
  ChainId,
  ChainType,
  createClient,
  type ExecutionAction,
  type ExecutionActionType,
  type ExtendedChain,
  type LiFiStep,
  type LiFiStepExtended,
  type Route,
  type RouteExtended,
  type SDKClient,
  type Token,
} from '@lifi/sdk'
import {
  type Adapter,
  type SignedTransaction,
  type Transaction,
  WalletSignTransactionError,
} from '@tronweb3/tronwallet-abstract-adapter'
import { providers, TronWeb, utils } from 'tronweb'
import { vi } from 'vitest'
import { tronWebCache } from '../../rpc/callTronRpcsWithRetry.js'
import { TronProvider } from '../../TronProvider.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const API_URL = 'https://api.lifi.test/v1'
const TRON_RPC_URL = 'https://tron-node.test'
const TRON_EXPLORER_URL = 'https://tronscan.test/'

/** A throwaway key. It is never funded; it only makes real signatures. */
const WALLET_PRIVATE_KEY = '0123456789abcdef'.repeat(4)
export const WALLET_ADDRESS: string = TronWeb.address.fromPrivateKey(
  WALLET_PRIVATE_KEY
) as string
/** The `41`-prefixed hex form, as `owner_address` carries it. */
const WALLET_HEX = TronWeb.address.toHex(WALLET_ADDRESS)

/** The quote's call target and `estimate.approvalAddress` (LI.FI diamond). */
export const LIFI_DIAMOND: string = TronWeb.address.fromHex(
  `41${'22'.repeat(20)}`
)
const LIFI_DIAMOND_HEX = TronWeb.address.toHex(LIFI_DIAMOND)

/** The bridge receiver on Ethereum. */
const EVM_RECEIVER = `0x${'33'.repeat(20)}`

const TRX = {
  address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
  chainId: ChainId.TRN,
  symbol: 'TRX',
  decimals: 6,
  name: 'TRON',
  priceUSD: '0.3',
  coinKey: 'TRX',
  logoURI: '',
} as Token

export const USDT: Token = {
  address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  chainId: ChainId.TRN,
  symbol: 'USDT',
  decimals: 6,
  name: 'Tether USD',
  priceUSD: '1',
  coinKey: 'USDT',
  logoURI: '',
} as Token
const USDT_HEX = TronWeb.address.toHex(USDT.address)

const USDC_ETHEREUM = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chainId: ChainId.ETH,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as Token

const TRON_CHAIN = {
  id: ChainId.TRN,
  key: 'trn',
  chainType: ChainType.TVM,
  name: 'Tron',
  coin: 'TRX',
  mainnet: true,
  logoURI: '',
  nativeToken: TRX,
  metamask: {
    chainId: '0x2b6653dc',
    chainName: 'Tron',
    nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
    rpcUrls: [TRON_RPC_URL],
    blockExplorerUrls: [TRON_EXPLORER_URL],
  },
} as unknown as ExtendedChain

const ETHEREUM_CHAIN = {
  id: ChainId.ETH,
  key: 'eth',
  chainType: ChainType.EVM,
  name: 'Ethereum',
  coin: 'ETH',
  mainnet: true,
  logoURI: '',
  metamask: {
    chainId: '0x1',
    chainName: 'Ethereum',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum.test'],
    blockExplorerUrls: ['https://etherscan.test/'],
  },
} as unknown as ExtendedChain

/**
 * The head block the fake node reports. `getCurrentRefBlockParams` turns it
 * into the TAPOS fields of every transaction the SDK builds or re-anchors.
 */
const HEAD_BLOCK = {
  number: 70_000_000,
  timestamp: 1_760_000_000_000,
  blockID: `${(70_000_000).toString(16).padStart(16, '0')}${'ab'.repeat(24)}`,
}

/** The stale TAPOS fields of a backend quote (re-anchored before signing). */
const QUOTE_BLOCK = {
  ref_block_bytes: '0001',
  ref_block_hash: '0000000000000001',
  expiration: 1_700_000_060_000,
  timestamp: 1_700_000_000_000,
}

const TRIGGER_SMART_CONTRACT = 'TriggerSmartContract'
const TRIGGER_TYPE_URL = 'type.googleapis.com/protocol.TriggerSmartContract'
const QUOTE_FEE_LIMIT = 150_000_000
const selectorOf = (signature: string): string =>
  TronWeb.sha3(signature).slice(2, 10)
/** The selector of the swap/bridge call in every quote (opaque to the SDK). */
const QUOTE_SELECTOR = selectorOf('swapTokensGeneric(bytes32,uint256)')
const APPROVE_SELECTOR = selectorOf('approve(address,uint256)')

const TRC20_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

// ---------------------------------------------------------------------------
// Quotes and routes
// ---------------------------------------------------------------------------

/** The `TriggerSmartContract` value of a quote, as the harness built it. */
export interface QuotedCall {
  owner_address: string
  contract_address: string
  data: string
  call_value?: number
}

let nonceCounter = 0
/** Quoted steps and calls, to answer `/status` and to let specs compare. */
const quotedSteps = new Map<string, LiFiStep>()
const quotedCalls = new Map<string, QuotedCall>()

const hex64 = (value: bigint | number): string =>
  BigInt(value).toString(16).padStart(64, '0')

const toRawDataHex = (rawData: Record<string, unknown>): string =>
  utils.transaction.txPbToRawDataHex(
    utils.transaction.txJsonToPb({ raw_data: rawData, visible: false } as never)
  )

/**
 * A backend-style `transactionRequest.data` for `step`: the `raw_data_hex`
 * of a TriggerSmartContract call to the diamond, with the stale TAPOS fields
 * a quote carries. A new nonce makes every quote's txID unique.
 */
const quoteTransactionData = (step: LiFiStep): string => {
  nonceCounter += 1
  const isNative = step.action.fromToken.address === TRX.address
  const call: QuotedCall = {
    owner_address: WALLET_HEX,
    contract_address: LIFI_DIAMOND_HEX,
    data: `${QUOTE_SELECTOR}${hex64(nonceCounter)}${hex64(BigInt(step.action.fromAmount))}`,
    ...(isNative && { call_value: Number(step.action.fromAmount) }),
  }
  quotedSteps.set(call.data, step)
  const rawDataHex = toRawDataHex({
    contract: [
      {
        parameter: { value: call, type_url: TRIGGER_TYPE_URL },
        type: TRIGGER_SMART_CONTRACT,
      },
    ],
    ...QUOTE_BLOCK,
    fee_limit: QUOTE_FEE_LIMIT,
  })
  quotedCalls.set(rawDataHex, call)
  return `0x${rawDataHex}`
}

/** The call the harness put into a quote's `transactionRequest.data`. */
export const quotedCallOf = (transactionRequestData: unknown): QuotedCall => {
  const call = quotedCalls.get(
    String(transactionRequestData).replace(/^0x/, '')
  )
  if (!call) {
    throw new Error('Not a quote built by the Tron flow harness')
  }
  return call
}

export type StepKind = 'trx-swap' | 'trc20-swap' | 'bridge'

let stepCounter = 0

/**
 * A quoted step with a real `transactionRequest`.
 *
 * - `trx-swap`: 1 TRX → USDT on Tron (native, no allowance check).
 * - `trc20-swap`: 2 USDT → TRX on Tron (approval address set).
 * - `bridge`: 1 TRX on Tron → USDC on Ethereum.
 */
export const buildStep = (kind: StepKind): LiFiStepExtended => {
  stepCounter += 1
  const isBridge = kind === 'bridge'
  const fromToken = kind === 'trc20-swap' ? USDT : TRX
  const toToken = isBridge ? USDC_ETHEREUM : kind === 'trc20-swap' ? TRX : USDT
  const fromAmount = kind === 'trc20-swap' ? '2000000' : '1000000'
  const toAmount = kind === 'trc20-swap' ? '6600000' : '300000'
  const tool = isBridge ? 'allbridge' : 'sunswap'
  const step = {
    id: `tron-flow-step-${stepCounter}`,
    type: 'lifi',
    tool,
    toolDetails: { key: tool, name: tool, logoURI: '' },
    action: {
      fromChainId: ChainId.TRN,
      toChainId: isBridge ? ChainId.ETH : ChainId.TRN,
      fromToken,
      toToken,
      fromAmount,
      slippage: 0.005,
      fromAddress: WALLET_ADDRESS,
      toAddress: isBridge ? EVM_RECEIVER : WALLET_ADDRESS,
    },
    estimate: {
      tool,
      fromAmount,
      fromAmountUSD: '0.3',
      toAmount,
      toAmountMin: toAmount,
      toAmountUSD: '0.3',
      approvalAddress: LIFI_DIAMOND,
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
    },
    includedSteps: [],
  } as unknown as LiFiStepExtended
  step.transactionRequest = { data: quoteTransactionData(step) }
  return step
}

let routeCounter = 0

/** A one-step route with a unique id (core execution state is keyed by it). */
export const buildRoute = (step: LiFiStepExtended): Route => {
  routeCounter += 1
  return {
    id: `tron-flow-route-${routeCounter}`,
    fromChainId: step.action.fromChainId,
    toChainId: step.action.toChainId,
    fromAmount: step.action.fromAmount,
    fromAmountUSD: '0.3',
    fromToken: step.action.fromToken,
    toToken: step.action.toToken,
    toAmount: step.estimate.toAmount,
    toAmountMin: step.estimate.toAmountMin,
    toAmountUSD: '0.3',
    fromAddress: step.action.fromAddress,
    toAddress: step.action.toAddress,
    gasCostUSD: '0',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// Fake Tron node and LI.FI API
// ---------------------------------------------------------------------------

export interface FakeTronNetwork {
  /** Signed transactions the node received for broadcast, in order (copies). */
  readonly broadcasts: SignedTransaction[]
  /** Every node endpoint called, in order (`wallet/getblock`, …). */
  readonly nodeCalls: string[]
  /** Every LI.FI API call, in order (`POST /advanced/stepTransaction`, …). */
  readonly apiCalls: string[]
  /** Quotes `/advanced/stepTransaction` returned, in order. */
  readonly requotes: LiFiStep[]
  /** The query of every `/status` request, in order. */
  readonly statusRequests: Record<string, string>[]
  /** Requests no fake implements. Each spec's `afterEach` asserts none. */
  readonly unknown: string[]
  /** Contract result (`'REVERT'`, …) of the next transaction that lands. */
  failNextWith: string | undefined
  /** On-chain TRC-20 allowance of `owner` for `spender`. */
  allowance(token: string, owner: string, spender: string): bigint
  setAllowance(
    token: string,
    owner: string,
    spender: string,
    amount: bigint
  ): void
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

const headBlock = () => ({
  blockID: HEAD_BLOCK.blockID,
  block_header: {
    raw_data: { number: HEAD_BLOCK.number, timestamp: HEAD_BLOCK.timestamp },
  },
})

/** What `getCurrentRefBlockParams` derives from {@link HEAD_BLOCK}. */
const refBlockParams = () => ({
  ref_block_bytes: HEAD_BLOCK.number.toString(16).slice(-4).padStart(4, '0'),
  ref_block_hash: HEAD_BLOCK.blockID.slice(16, 32),
  expiration: HEAD_BLOCK.timestamp + 60_000,
  timestamp: HEAD_BLOCK.timestamp,
})

/** A 32-byte ABI word holding an address, as a base58 Tron address. */
const wordToAddress = (word: string): string =>
  TronWeb.address.fromHex(`41${word.slice(24)}`)

const words = (parameter: string): string[] => parameter.match(/.{64}/g) ?? []

const allowanceKey = (token: string, owner: string, spender: string): string =>
  `${token}:${owner}:${spender}`

const createFakeTronNetwork = (): FakeTronNetwork & {
  request(host: string, url: string, payload?: unknown): Promise<unknown>
  fetch: typeof fetch
} => {
  const landed = new Map<string, string>()
  const trc20Balances = new Map<string, bigint>([
    [`${USDT.address}:${WALLET_ADDRESS}`, 1_000_000_000n],
  ])
  const allowances = new Map<string, bigint>()
  const trxBalance = 1_000_000_000n

  const transactionInfo = (txID: string) => {
    const result = landed.get(txID)
    return {
      id: txID,
      fee: 345_000,
      blockNumber: HEAD_BLOCK.number + 1,
      blockTimeStamp: HEAD_BLOCK.timestamp + 3_000,
      contractResult: [''],
      receipt: {
        energy_usage_total: 13_000,
        net_usage: 345,
        result,
      },
      ...(result !== 'SUCCESS' && { result: 'FAILED' }),
    }
  }

  /** What an included, successful transaction changes on the fake chain. */
  const apply = (transaction: SignedTransaction): void => {
    const value = transaction.raw_data.contract[0]?.parameter.value as {
      data?: string
      owner_address: string
      contract_address?: string
    }
    const data = value.data?.toLowerCase() ?? ''
    if (
      value.contract_address?.toLowerCase() === USDT_HEX &&
      data.startsWith(APPROVE_SELECTOR)
    ) {
      const [spender, amount] = words(data.slice(8))
      network.setAllowance(
        USDT.address,
        TronWeb.address.fromHex(value.owner_address),
        wordToAddress(spender),
        BigInt(`0x${amount}`)
      )
    }
  }

  /** The `/status` answer for a landed swap or bridge transaction. */
  const statusDone = (txHash: string) => {
    const broadcast = network.broadcasts.find((tx) => tx.txID === txHash)
    const value = broadcast?.raw_data.contract[0]?.parameter.value as
      | { data?: string }
      | undefined
    // The SDK re-encodes the quote through TronWeb's deserializer, which
    // upper-cases hex fields.
    const step = value?.data
      ? quotedSteps.get(value.data.toLowerCase())
      : undefined
    if (!step) {
      return undefined
    }
    const isBridge = step.action.toChainId !== ChainId.TRN
    const receivingHash = isBridge ? `0x${txHash}` : txHash
    return {
      transactionId: `0x${txHash}`,
      status: 'DONE',
      substatus: 'COMPLETED',
      substatusMessage: 'The transfer is complete.',
      tool: step.tool,
      fromAddress: step.action.fromAddress,
      toAddress: step.action.toAddress,
      lifiExplorerLink: `https://scan.li.fi/tx/${txHash}`,
      sending: {
        txHash,
        txLink: `${TRON_EXPLORER_URL}#/transaction/${txHash}`,
        chainId: ChainId.TRN,
        amount: step.action.fromAmount,
        token: step.action.fromToken,
        gasPrice: '420',
        gasUsed: '345',
        gasToken: TRX,
        gasAmount: '345000',
        gasAmountUSD: '0.1',
        timestamp: 1,
      },
      receiving: {
        txHash: receivingHash,
        txLink: isBridge
          ? `https://etherscan.test/tx/${receivingHash}`
          : `${TRON_EXPLORER_URL}#/transaction/${receivingHash}`,
        chainId: step.action.toChainId,
        amount: step.estimate.toAmount,
        token: step.action.toToken,
        timestamp: 2,
      },
    }
  }

  const network = {
    broadcasts: [] as SignedTransaction[],
    nodeCalls: [] as string[],
    apiCalls: [] as string[],
    requotes: [] as LiFiStep[],
    statusRequests: [] as Record<string, string>[],
    unknown: [] as string[],
    failNextWith: undefined as string | undefined,
    allowance(token: string, owner: string, spender: string): bigint {
      return allowances.get(allowanceKey(token, owner, spender)) ?? 0n
    },
    setAllowance(
      token: string,
      owner: string,
      spender: string,
      amount: bigint
    ): void {
      allowances.set(allowanceKey(token, owner, spender), amount)
    },
    async request(host: string, url: string, payload: unknown = {}) {
      const endpoint = url.replace(/^\//, '')
      const body = payload as Record<string, unknown>
      if (host !== TRON_RPC_URL) {
        network.unknown.push(`${host}/${endpoint}`)
        throw new Error(`Fake Tron node: unknown host ${host}`)
      }
      // A contract call also records its function, so an allowance read and a
      // balance read stay apart.
      network.nodeCalls.push(
        body.function_selector
          ? `${endpoint} ${String(body.function_selector)}`
          : endpoint
      )
      switch (endpoint) {
        // `getCurrentRefBlockParams` (POST, `detail: false`) and
        // `getCurrentBlock`.
        case 'wallet/getblock':
        case 'wallet/getnowblock':
          return headBlock()
        // `trx.getBalance` (TRX balance).
        case 'walletsolidity/getaccount':
          return body.address === WALLET_HEX
            ? { address: WALLET_HEX, balance: Number(trxBalance) }
            : {}
        // `tronWeb.contract().at(token)`: the ABI of a TRC-20.
        case 'wallet/getcontract':
          return body.value === USDT_HEX
            ? {
                contract_address: USDT_HEX,
                bytecode: '',
                abi: { entrys: TRC20_ABI },
              }
            : {}
        // TRC-20 `allowance(owner, spender)` and `balanceOf(account)` reads.
        case 'wallet/triggerconstantcontract': {
          const token = TronWeb.address.fromHex(String(body.contract_address))
          const args = words(String(body.parameter ?? ''))
          let value: bigint | undefined
          if (body.function_selector === 'allowance(address,address)') {
            value = network.allowance(
              token,
              wordToAddress(args[0]),
              wordToAddress(args[1])
            )
          } else if (body.function_selector === 'balanceOf(address)') {
            value =
              trc20Balances.get(`${token}:${wordToAddress(args[0])}`) ?? 0n
          }
          if (value === undefined) {
            break
          }
          return {
            result: { result: true },
            energy_used: 1_000,
            constant_result: [hex64(value)],
          }
        }
        // The TRC-20 `approve` the SDK builds through the node.
        case 'wallet/triggersmartcontract': {
          if (body.function_selector !== 'approve(address,uint256)') {
            break
          }
          const value = {
            data: `${APPROVE_SELECTOR}${String(body.parameter)}`,
            owner_address: String(body.owner_address),
            contract_address: String(body.contract_address),
          }
          const rawData = {
            contract: [
              {
                parameter: { value, type_url: TRIGGER_TYPE_URL },
                type: TRIGGER_SMART_CONTRACT,
              },
            ],
            ...refBlockParams(),
            fee_limit: Number(body.fee_limit),
          }
          const pb = utils.transaction.txJsonToPb({
            raw_data: rawData,
            visible: false,
          } as never)
          return {
            result: { result: true },
            transaction: {
              visible: false,
              txID: utils.transaction.txPbToTxID(pb).replace(/^0x/, ''),
              raw_data: rawData,
              raw_data_hex: utils.transaction
                .txPbToRawDataHex(pb)
                .toLowerCase(),
            },
          }
        }
        case 'wallet/broadcasttransaction': {
          const transaction = structuredClone(payload) as SignedTransaction
          network.broadcasts.push(transaction)
          if (landed.has(transaction.txID)) {
            return {
              result: false,
              code: 'DUP_TRANSACTION_ERROR',
              txid: transaction.txID,
              message: '4475702074726e73616374696f6e2e',
            }
          }
          const result = network.failNextWith ?? 'SUCCESS'
          network.failNextWith = undefined
          landed.set(transaction.txID, result)
          if (result === 'SUCCESS') {
            apply(transaction)
          }
          return { result: true, txid: transaction.txID }
        }
        // `trx.getTransactionInfo`: `{}` until the transaction is included.
        case 'walletsolidity/gettransactioninfobyid': {
          const txID = String(body.value)
          return landed.has(txID) ? transactionInfo(txID) : {}
        }
        default:
          break
      }
      network.unknown.push(`${endpoint} ${JSON.stringify(payload)}`)
      throw new Error(`Fake Tron node: ${endpoint} is not implemented`)
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      const method = init?.method ?? 'GET'
      if (!url.startsWith(API_URL)) {
        network.unknown.push(`${method} ${url}`)
        throw new Error(`Fake LI.FI API: unexpected ${url}`)
      }
      const { pathname, searchParams } = new URL(url)
      const path = pathname.slice(new URL(API_URL).pathname.length)
      network.apiCalls.push(`${method} ${path}`)
      if (method === 'POST' && path === '/advanced/stepTransaction') {
        const requested = JSON.parse(String(init?.body)) as LiFiStep
        const quote = {
          ...requested,
          transactionRequest: { data: quoteTransactionData(requested) },
        }
        network.requotes.push(quote)
        return json(quote)
      }
      if (method === 'GET' && path === '/status') {
        network.statusRequests.push(Object.fromEntries(searchParams))
        const txHash = searchParams.get('txHash') ?? ''
        const answer = landed.has(txHash) ? statusDone(txHash) : undefined
        if (answer) {
          return json(answer)
        }
        network.unknown.push(`GET /status for ${txHash}`)
        return json(
          {
            message: 'Transaction hash is not found in any chain.',
            code: 1003,
          },
          404
        )
      }
      network.unknown.push(`${method} ${path}`)
      throw new Error(`Fake LI.FI API: unexpected ${method} ${path}`)
    }) as typeof fetch,
  }
  return network
}

/**
 * Builds a fresh fake network and installs it: TronWeb's HTTP seam, the
 * `fetch` seam, and an empty TronWeb cache (the provider keeps one TronWeb
 * per RPC URL at module level). Call it in `beforeEach`; undo it in
 * `afterEach` with `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`.
 */
export const installFakeTronNetwork = (): FakeTronNetwork => {
  const network = createFakeTronNetwork()
  tronWebCache.clear()
  vi.spyOn(providers.HttpProvider.prototype, 'request').mockImplementation(
    function (
      this: InstanceType<typeof providers.HttpProvider>,
      url: string,
      payload?: unknown
    ) {
      return network.request(this.host, url, payload) as Promise<never>
    }
  )
  vi.stubGlobal('fetch', network.fetch)
  return network
}

// ---------------------------------------------------------------------------
// Wallet and page
// ---------------------------------------------------------------------------

export interface FakeTronWallet {
  readonly adapter: Adapter
  /** Every `signTransaction` request, in order (copies of what was sent). */
  readonly requests: Transaction[]
  /** Every signed transaction the wallet returned, in order. */
  readonly signed: SignedTransaction[]
  /** Rejects the next sign request the way TronLink reports "Reject". */
  rejectNext(): void
}

const createFakeTronWallet = (): FakeTronWallet => {
  // Signs locally: `trx.sign` checks the owner and never calls the node.
  const signer = new TronWeb({
    fullHost: 'https://wallet-signer.test',
    privateKey: WALLET_PRIVATE_KEY,
  })
  let rejections = 0
  const wallet = {
    requests: [] as Transaction[],
    signed: [] as SignedTransaction[],
    rejectNext(): void {
      rejections += 1
    },
    adapter: {
      address: WALLET_ADDRESS,
      async signTransaction(
        transaction: Transaction
      ): Promise<SignedTransaction> {
        wallet.requests.push(structuredClone(transaction))
        if (rejections > 0) {
          rejections -= 1
          throw new WalletSignTransactionError('Confirmation declined by user')
        }
        const signed = (await signer.trx.sign(
          transaction as never
        )) as unknown as SignedTransaction
        wallet.signed.push(structuredClone(signed))
        return signed
      },
    } as unknown as Adapter,
  }
  return wallet
}

/** One browser page: a wallet, a provider and an SDK client. */
export interface Page {
  readonly client: SDKClient
  readonly wallet: FakeTronWallet
}

export const openPage = (): Page => {
  // A new page starts without the provider's module-level TronWeb instances.
  tronWebCache.clear()
  const wallet = createFakeTronWallet()
  const client = createClient({
    integrator: 'tron-flow-specs',
    apiUrl: API_URL,
    preloadChains: false,
    disableVersionCheck: true,
    providers: [TronProvider({ getWallet: async () => wallet.adapter })],
    rpcUrls: { [ChainId.TRN]: [TRON_RPC_URL] },
  })
  client.setChains([TRON_CHAIN, ETHEREUM_CHAIN])
  return { client, wallet }
}

// ---------------------------------------------------------------------------
// Route updates
// ---------------------------------------------------------------------------

export interface RouteRecorder {
  /** Pass as `updateRouteHook`. Stores a JSON copy, as a widget persists it. */
  readonly updateRouteHook: (route: RouteExtended) => void
  /** Every route the hook saw, in order. */
  readonly snapshots: RouteExtended[]
  /** The last route the hook saw. */
  last(): RouteExtended
  /**
   * `TYPE:STATUS` each time an action's status changed between two hook
   * calls, in order. A hook call that changes no status adds nothing, so
   * consecutive duplicates never appear.
   */
  transitions(): string[]
}

export const recordRoute = (): RouteRecorder => {
  const snapshots: RouteExtended[] = []
  return {
    snapshots,
    updateRouteHook: (route: RouteExtended): void => {
      snapshots.push(JSON.parse(JSON.stringify(route)))
    },
    last(): RouteExtended {
      const route = snapshots.at(-1)
      if (!route) {
        throw new Error('updateRouteHook was never called')
      }
      return route
    },
    transitions(): string[] {
      const seen = new Map<string, string>()
      const pairs: string[] = []
      for (const route of snapshots) {
        for (const action of route.steps.flatMap(
          (step) => step.execution?.actions ?? []
        )) {
          if (seen.get(action.type) !== action.status) {
            seen.set(action.type, action.status)
            pairs.push(`${action.type}:${action.status}`)
          }
        }
      }
      return pairs
    },
  }
}

/** The action of `type` in the route's first step. */
export const actionOf = (
  route: RouteExtended,
  type: ExecutionActionType
): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === type)
