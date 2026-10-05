/**
 * Network-level harness for the Solana money-path flow specs
 * (`*.flow.spec.ts` beside this file).
 *
 * The specs drive the public entry points (`executeRoute`, `resumeRoute`)
 * through the real `SolanaProvider`, the real `SolanaStepExecutor`, its real
 * tasks and the real `@solana/kit` RPC clients. The one seam is
 * `globalThis.fetch`: kit's HTTP transport and the LI.FI API client both look
 * it up at call time, so one fake answers the Solana JSON-RPC methods, the
 * Jito methods and the LI.FI API (`/chains`, `/advanced/stepTransaction`,
 * `/status`). Nothing inside the provider is mocked.
 *
 * The wallet is a wallet-standard wallet around `KeypairWalletAdapter`: it
 * signs with a real throwaway key, so every signature and every hash is real.
 * It records each sign request and can reject one the way a user does.
 *
 * Isolation. The Solana RPC registry caches clients and Jito probe answers by
 * URL for the life of the module (a probe answer never expires). Every
 * network therefore gets its own host names (`<node>-<id>.solana.test`), so a
 * test never sees a client, or a probe answer, that an earlier test made.
 * Route ids carry the network id, and every quote carries a memo with the
 * network id, so `executionState` and `TRANSACTION_HASH_OBSERVERS` (keyed by
 * route id and by hash) never collide either.
 *
 * Unknown requests fail loudly: the fake answers them with an error and
 * records them in `unknown`; every spec asserts that list is empty. A throw
 * inside the fake (a bad request, or a spec's `onSend`) goes there too, as
 * `harness error: <method or path> on <url>: <message>`: the provider
 * swallows send errors, so the throw would otherwise vanish. A JSON-RPC
 * request then gets the error `-32603`; an API request still rejects.
 *
 * `.mock.ts` keeps this file out of `dist` (tsdown entry, tsconfig exclude,
 * package.json `files`).
 */
import {
  ChainId,
  ChainType,
  createClient,
  type ExtendedChain,
  type LiFiStep,
  type Route,
  type RouteExtended,
  type RouteOptions,
  type RPCUrlsByRole,
  type SDKClient,
  type Token,
} from '@lifi/sdk'
import {
  type Address,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
  verifySignature,
} from '@solana/kit'
import {
  SolanaSignTransaction,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from '@solana/wallet-standard-features'
import type { Wallet } from '@wallet-standard/base'
import { SolanaProvider } from '../../SolanaProvider.js'
import { KeypairWalletAdapter } from '../../utils/KeypairWalletAdapter.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const API_URL: string = 'https://api.lifi.test/v1'

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const BLOCKHASH = blockhash(
  getBase58Decoder().decode(new Uint8Array(32).fill(7))
)
const CURRENT_SLOT = 300_000_000
/** Only the blockhash travels on the wire; no code path reads this. */
const LAST_VALID_BLOCK_HEIGHT = 280_000_150

/** What `getBalance` answers: 10 SOL, far above any amount the specs move. */
const WALLET_LAMPORTS = 10_000_000_000

/** `step.action.fromAmount` and `estimate.fromAmount` (lamports). */
export const FROM_AMOUNT: string = '1000000'
/** `estimate.toAmount`; `/status` answers a different amount on purpose. */
export const ESTIMATED_TO_AMOUNT: string = '100000'
/** `receiving.amount` of a same-chain swap in the `/status` answer. */
export const RECEIVED_SWAP_AMOUNT: string = '99800'
/** `receiving.amount` of a bridge in the `/status` answer. */
export const RECEIVED_BRIDGE_AMOUNT: string = '99700'
/** `receiving.txHash` of a bridge in the `/status` answer. */
export const DESTINATION_TX_HASH: string = `0x${'ab'.repeat(32)}`

export const SOL_TOKEN: Token = {
  address: '11111111111111111111111111111111',
  chainId: ChainId.SOL,
  symbol: 'SOL',
  decimals: 9,
  name: 'SOL',
  priceUSD: '100',
  coinKey: 'SOL',
  logoURI: '',
} as Token

export const SOL_USDC_TOKEN: Token = {
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  chainId: ChainId.SOL,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as Token

export const ETH_USDC_TOKEN: Token = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chainId: ChainId.ETH,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as Token

const ETH_TOKEN = {
  address: '0x0000000000000000000000000000000000000000',
  chainId: ChainId.ETH,
  symbol: 'ETH',
  decimals: 18,
  name: 'ETH',
  priceUSD: '3000',
  coinKey: 'ETH',
  logoURI: '',
} as Token

export const SOLANA_EXPLORER: string = 'https://solscan.test/'
export const ETHEREUM_EXPLORER: string = 'https://etherscan.test/'

const SOLANA_CHAIN = {
  id: ChainId.SOL,
  key: 'sol',
  chainType: ChainType.SVM,
  name: 'Solana',
  coin: 'SOL',
  mainnet: true,
  logoURI: '',
  nativeToken: SOL_TOKEN,
  metamask: {
    chainId: '0x416edef1601be',
    chainName: 'Solana',
    nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
    // The client config always names the Solana RPCs; for Solana the client
    // never merges these in (`getRpcUrlsFromChains` skips `ChainId.SOL`).
    rpcUrls: ['https://chain-list.solana.test/'],
    blockExplorerUrls: [SOLANA_EXPLORER],
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
  nativeToken: ETH_TOKEN,
  metamask: {
    chainId: '0x1',
    chainName: 'Ethereum',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://eth.rpc.test/'],
    blockExplorerUrls: [ETHEREUM_EXPLORER],
  },
} as unknown as ExtendedChain

/** An unsigned single transaction in base64 wire format, as the API sends it. */
export const buildUnsignedTransaction = (
  feePayer: Address,
  memo: string
): string =>
  getBase64EncodedWireTransaction(
    compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(feePayer, m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: BLOCKHASH,
              lastValidBlockHeight: BigInt(LAST_VALID_BLOCK_HEIGHT),
            },
            m
          ),
        (m) =>
          appendTransactionMessageInstruction(
            {
              programAddress: MEMO_PROGRAM,
              data: new TextEncoder().encode(memo),
            },
            m
          )
      )
    )
  )

/** The fee payer signature (the Solana `txHash`) of a base64 wire transaction. */
export const signatureOf = (wireTransaction: string): string =>
  getSignatureFromTransaction(
    getTransactionDecoder().decode(getBase64Encoder().encode(wireTransaction))
  )

const toBase64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes)

// ---------------------------------------------------------------------------
// Fake network: Solana JSON-RPC, Jito and the LI.FI API behind one `fetch`
// ---------------------------------------------------------------------------

/**
 * `standard`: a plain Solana node; the Jito methods answer "Method not
 * found", as on a real node. `jito`: a Jito block engine that also answers
 * the Solana methods.
 */
export type NodeKind = 'standard' | 'jito'

export interface RpcCall {
  /** The node URL the request went to. */
  url: string
  method: string
  params: unknown[]
}

export interface ApiCall {
  method: string
  /** The path below `API_URL`, for example `/advanced/stepTransaction`. */
  path: string
  query: Record<string, string>
}

export interface FakeNetwork {
  /** Unique per network; part of every host name, route id and memo. */
  readonly id: number
  /** The unique URL of the node `name`. Throws for a name not in `nodes`. */
  url(name: string): string
  /** Every JSON-RPC request, in arrival order. */
  readonly rpcCalls: RpcCall[]
  /** Every LI.FI API request, in arrival order. */
  readonly apiCalls: ApiCall[]
  /**
   * Requests the fake does not answer, and throws inside the fake
   * (`harness error: …`). Every spec asserts it stays empty.
   */
  readonly unknown: string[]
  /** `transactionRequest.data` of every `/advanced/stepTransaction` answer. */
  readonly quotes: (string | string[])[]
  /** Included signatures and their on-chain error (`null` = success). */
  readonly landed: Map<string, unknown>
  /**
   * On-chain error for the next transaction `sendTransaction` includes
   * (`sendBundle` always includes without an error). Cleared once used.
   */
  failNext: unknown
  /**
   * Called when a `sendTransaction` or `sendBundle` request arrives, before
   * the fake includes anything. Lets a spec snapshot the route at that point.
   * A throw in it goes to `unknown`; the node answers the error `-32603`.
   */
  onSend?: (wireTransactions: string[], call: RpcCall) => void
  /** Forgets what the chain included: the send never reached a node. */
  forgetChain(): void
  /** Clears the call records; keeps the chain state. */
  clearRecords(): void
  fetch: typeof fetch
}

let networkCounter = 0

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

const abortError = (): Error =>
  Object.assign(new Error('This operation was aborted'), {
    name: 'AbortError',
  })

/** `true` when every signature slot holds a valid signature of the message. */
const isFullySigned = async (wireTransaction: string): Promise<boolean> => {
  const transaction = getTransactionDecoder().decode(
    getBase64Encoder().encode(wireTransaction)
  )
  for (const [signer, signature] of Object.entries(transaction.signatures)) {
    if (!signature) {
      return false
    }
    const key = await getPublicKeyFromAddress(address(signer))
    const valid = await verifySignature(
      key,
      signatureBytes(signature),
      transaction.messageBytes
    )
    if (!valid) {
      return false
    }
  }
  return true
}

const bundleIdOf = async (signatures: string[]): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(signatures.join(','))
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const NOT_ANSWERED = Symbol('not answered')

type RpcError = { code: number; message: string }

type RpcRequest = { id: number; method: string; params?: unknown[] }

/**
 * Creates a fake Solana network with the given nodes, for example
 * `{ read: 'standard' }` or `{ read: 'standard', jito: 'jito' }`.
 *
 * It answers only the methods main calls on the flow paths. Not answered on
 * purpose: `isBlockhashValid` (the deadline's expiry probe first ticks after
 * 400 ms, and every path here confirms on the first status read) and the
 * LI.FI `/status` of a hash that did not land without an error (main would
 * poll it again after 5 s). Either one means a path changed.
 */
export const createFakeNetwork = (
  nodes: Record<string, NodeKind>
): FakeNetwork => {
  networkCounter += 1
  const id = networkCounter
  const nodeUrls = new Map<string, NodeKind>(
    Object.entries(nodes).map(([name, kind]) => [
      `https://${name}-${id}.solana.test/`,
      kind,
    ])
  )
  const bundles = new Map<string, string[]>()
  let quoteCounter = 0

  const rpcError = (error: RpcError): { error: RpcError } => ({ error })

  const answerRpc = async (
    kind: NodeKind,
    call: RpcCall
  ): Promise<unknown | { error: RpcError } | typeof NOT_ANSWERED> => {
    const context = { slot: CURRENT_SLOT }
    const { method, params } = call
    switch (method) {
      case 'getSlot':
        return CURRENT_SLOT
      case 'getBalance':
        return { context, value: WALLET_LAMPORTS }
      case 'getTokenAccountsByOwner':
        return { context, value: [] }
      case 'simulateTransaction':
        return {
          context,
          value: {
            err: null,
            logs: [],
            accounts: null,
            unitsConsumed: 1000,
            returnData: null,
          },
        }
      case 'sendTransaction': {
        const wire = params[0] as string
        network.onSend?.([wire], call)
        if (!(await isFullySigned(wire))) {
          return rpcError({
            code: -32003,
            message: 'Transaction signature verification failure',
          })
        }
        const signature = signatureOf(wire)
        if (!network.landed.has(signature)) {
          network.landed.set(signature, network.failNext ?? null)
          network.failNext = undefined
        }
        return signature
      }
      case 'getSignatureStatuses': {
        const signatures = params[0] as string[]
        return {
          context,
          value: signatures.map((signature) => {
            if (!network.landed.has(signature)) {
              return null
            }
            const err = network.landed.get(signature)
            return {
              slot: CURRENT_SLOT,
              confirmations: null,
              err,
              confirmationStatus: 'confirmed',
              status: err ? { Err: err } : { Ok: null },
            }
          }),
        }
      }
      case 'sendBundle':
      case 'getBundleStatuses': {
        if (kind !== 'jito') {
          // What a plain Solana node answers; the Jito probe reads it as
          // "unsupported".
          return rpcError({ code: -32601, message: 'Method not found' })
        }
        if (method === 'getBundleStatuses') {
          const bundleIds = params[0] as string[]
          return {
            context,
            value: bundleIds.map((bundleId) => {
              const signatures = bundles.get(bundleId)
              return signatures
                ? {
                    bundle_id: bundleId,
                    transactions: signatures,
                    slot: CURRENT_SLOT,
                    confirmation_status: 'confirmed',
                    err: { Ok: null },
                  }
                : null
            }),
          }
        }
        const wires = params[0] as string[]
        network.onSend?.(wires, call)
        for (const wire of wires) {
          if (!(await isFullySigned(wire))) {
            return rpcError({
              code: -32602,
              message: 'bundle contains an unsigned transaction',
            })
          }
        }
        const signatures = wires.map(signatureOf)
        const bundleId = await bundleIdOf(signatures)
        bundles.set(bundleId, signatures)
        for (const signature of signatures) {
          if (!network.landed.has(signature)) {
            network.landed.set(signature, null)
          }
        }
        return bundleId
      }
      default:
        return NOT_ANSWERED
    }
  }

  const quote = (fromAddress: Address, bundle: boolean): string | string[] => {
    quoteCounter += 1
    const memo = `network ${id} quote ${quoteCounter}`
    const data = bundle
      ? [
          buildUnsignedTransaction(fromAddress, `${memo} bundle 1`),
          buildUnsignedTransaction(fromAddress, `${memo} bundle 2`),
        ]
      : buildUnsignedTransaction(fromAddress, memo)
    network.quotes.push(data)
    return data
  }

  const statusAnswer = (query: Record<string, string>): unknown => {
    const txHash = query.txHash
    const isBridge = Number(query.toChain) !== ChainId.SOL
    return {
      status: 'DONE',
      substatus: 'COMPLETED',
      tool: query.bridge,
      sending: {
        txHash,
        txLink: `${SOLANA_EXPLORER}tx/${txHash}`,
        chainId: ChainId.SOL,
        amount: FROM_AMOUNT,
        token: SOL_TOKEN,
        gasPrice: '1',
        gasUsed: '5000',
        gasToken: SOL_TOKEN,
        gasAmount: '5000',
        gasAmountUSD: '0.0005',
        timestamp: 1,
      },
      receiving: isBridge
        ? {
            txHash: DESTINATION_TX_HASH,
            txLink: `${ETHEREUM_EXPLORER}tx/${DESTINATION_TX_HASH}`,
            chainId: ChainId.ETH,
            amount: RECEIVED_BRIDGE_AMOUNT,
            token: ETH_USDC_TOKEN,
            timestamp: 2,
          }
        : {
            txHash,
            txLink: `${SOLANA_EXPLORER}tx/${txHash}`,
            chainId: ChainId.SOL,
            amount: RECEIVED_SWAP_AMOUNT,
            token: SOL_USDC_TOKEN,
            timestamp: 2,
          },
    }
  }

  const answerApi = async (
    url: URL,
    init: RequestInit | undefined
  ): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace(new URL(API_URL).pathname, '')
    const query = Object.fromEntries(url.searchParams.entries())
    network.apiCalls.push({ method, path, query })
    if (method === 'GET' && path === '/chains') {
      return json({ chains: [SOLANA_CHAIN, ETHEREUM_CHAIN] })
    }
    if (method === 'POST' && path === '/advanced/stepTransaction') {
      const requested = JSON.parse(String(init?.body)) as LiFiStep
      return json({
        ...requested,
        transactionRequest: {
          data: quote(
            requested.action.fromAddress as Address,
            query.jitoBundle === 'true'
          ),
        },
      })
    }
    if (method === 'GET' && path === '/status') {
      // LI.FI knows a transaction only after it landed without an error.
      if (network.landed.get(query.txHash) !== null) {
        network.unknown.push(
          `/status for ${query.txHash}: not landed, or failed`
        )
        return json(
          {
            message: 'Transaction hash is not found in any chain.',
            code: 1003,
          },
          404
        )
      }
      return json(statusAnswer(query))
    }
    network.unknown.push(`API ${method} ${path}`)
    return json({ message: 'Not found' }, 404)
  }

  /** Records a throw inside the fake in `unknown`; returns its message. */
  const recordHarnessError = (
    what: string,
    url: string,
    error: unknown
  ): string => {
    const message = error instanceof Error ? error.message : String(error)
    network.unknown.push(`harness error: ${what} on ${url}: ${message}`)
    return message
  }

  const network: FakeNetwork = {
    id,
    url(name: string): string {
      const url = `https://${name}-${id}.solana.test/`
      if (!nodeUrls.has(url)) {
        throw new Error(`The fake network has no node named ${name}.`)
      }
      return url
    },
    rpcCalls: [],
    apiCalls: [],
    unknown: [],
    quotes: [],
    landed: new Map<string, unknown>(),
    failNext: undefined,
    onSend: undefined,
    forgetChain() {
      network.landed.clear()
      bundles.clear()
    },
    clearRecords() {
      network.rpcCalls.length = 0
      network.apiCalls.length = 0
      network.quotes.length = 0
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw abortError()
      }
      const url = urlOf(input)
      const kind = nodeUrls.get(url)
      if (kind) {
        let request: RpcRequest | null = null
        try {
          request = JSON.parse(String(init?.body)) as RpcRequest
          const call: RpcCall = {
            url,
            method: request.method,
            params: request.params ?? [],
          }
          network.rpcCalls.push(call)
          const result = await answerRpc(kind, call)
          if (result === NOT_ANSWERED) {
            network.unknown.push(`RPC ${request.method} on ${url}`)
            return json({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: 'Method not found' },
            })
          }
          if (result && typeof result === 'object' && 'error' in result) {
            return json({
              jsonrpc: '2.0',
              id: request.id,
              error: result.error,
            })
          }
          return json({ jsonrpc: '2.0', id: request.id, result })
        } catch (error) {
          // The provider swallows send errors (one RPC of several may
          // accept), so a throw here would vanish as a transport error.
          const message = recordHarnessError(
            request?.method ?? 'unparsed request',
            url,
            error
          )
          return json({
            jsonrpc: '2.0',
            id: request?.id ?? null,
            error: { code: -32603, message },
          })
        }
      }
      if (url.startsWith(API_URL)) {
        try {
          return await answerApi(new URL(url), init)
        } catch (error) {
          // Still thrown: the step fails where the spec sees it.
          recordHarnessError(new URL(url).pathname, url, error)
          throw error
        }
      }
      network.unknown.push(`fetch ${url}`)
      return json({ message: 'Not found' }, 404)
    }) as typeof fetch,
  }
  return network
}

/** The base64 wire transactions of every send of `method`, in order. */
export const sentTransactions = (
  network: FakeNetwork,
  method: 'sendTransaction' | 'sendBundle' = 'sendTransaction'
): string[] =>
  network.rpcCalls
    .filter((call) => call.method === method)
    .flatMap((call) =>
      method === 'sendBundle'
        ? (call.params[0] as string[])
        : [call.params[0] as string]
    )

/** `method@node` for every JSON-RPC request, in order; `node` is the name. */
export const rpcTrail = (network: FakeNetwork): string[] =>
  network.rpcCalls.map(
    (call) =>
      `${call.method}@${new URL(call.url).hostname.replace(`-${network.id}.solana.test`, '')}`
  )

/** The RPC methods that submit a transaction or confirm one. */
const SUBMIT_METHODS: string[] = [
  'simulateTransaction',
  'sendTransaction',
  'getSignatureStatuses',
  'sendBundle',
  'getBundleStatuses',
]

/**
 * `rpcTrail` without the balance reads of `CheckBalanceTask`: the simulation,
 * the sends, the Jito probe and the confirmation reads, in order.
 */
export const submitTrail = (network: FakeNetwork): string[] =>
  rpcTrail(network).filter((entry) =>
    SUBMIT_METHODS.includes(entry.slice(0, entry.indexOf('@')))
  )

/** `METHOD path` for every LI.FI API request, in order. */
export const apiTrail = (network: FakeNetwork): string[] =>
  network.apiCalls.map((call) => `${call.method} ${call.path}`)

// ---------------------------------------------------------------------------
// Fake wallet
// ---------------------------------------------------------------------------

export interface SignCall {
  /** Each transaction the SDK asked the wallet to sign, base64 wire format. */
  inputs: string[]
  /** What the wallet returned, base64 wire format; empty when it rejected. */
  outputs: string[]
  rejected: boolean
}

export interface FakeWallet {
  readonly wallet: Wallet
  readonly address: Address
  /** Every `solana:signTransaction` request, in order. */
  readonly signCalls: SignCall[]
  /** Rejects this many next sign requests the way a user does. */
  rejectNext: number
}

/**
 * What a wallet throws when the user rejects the request: the EIP-1193 code
 * 4001 that Phantom and other wallet-standard wallets use.
 */
const userRejection = (): Error =>
  Object.assign(new Error('User rejected the request.'), { code: 4001 })

export const createFakeWallet = async (
  secretKey: string
): Promise<FakeWallet> => {
  const adapter = new KeypairWalletAdapter(secretKey)
  await adapter.connect()
  const feature = adapter.features[SolanaSignTransaction]
  const signTransaction = async (
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> => {
    const call: SignCall = {
      inputs: inputs.map((input) => toBase64(input.transaction as Uint8Array)),
      outputs: [],
      rejected: false,
    }
    fake.signCalls.push(call)
    if (fake.rejectNext > 0) {
      fake.rejectNext -= 1
      call.rejected = true
      throw userRejection()
    }
    const outputs = await feature.signTransaction(...inputs)
    call.outputs = outputs.map((output) =>
      toBase64(output.signedTransaction as Uint8Array)
    )
    return outputs
  }
  const wallet = {
    version: adapter.version,
    name: adapter.name,
    icon: adapter.icon,
    chains: adapter.chains,
    accounts: [...adapter.accounts],
    features: {
      [SolanaSignTransaction]: { ...feature, signTransaction },
    },
  } as unknown as Wallet
  const fake: FakeWallet = {
    wallet,
    address: adapter.accounts[0].address as Address,
    signCalls: [],
    rejectNext: 0,
  }
  return fake
}

// ---------------------------------------------------------------------------
// One "page": a client, a provider and a wallet
// ---------------------------------------------------------------------------

export interface PageOptions {
  /** `rpcUrls[ChainId.SOL]`: a read list, or lists by role. */
  rpcUrls: string[] | RPCUrlsByRole
  routeOptions?: RouteOptions
}

/**
 * Builds what one page load builds: a `SolanaProvider` over the wallet and a
 * client that loads its chains from the fake `/chains`. A reload is a second
 * `openPage` with the same wallet key.
 */
export const openPage = (wallet: FakeWallet, options: PageOptions): SDKClient =>
  createClient({
    integrator: 'solana-flow-specs',
    apiUrl: API_URL,
    disableVersionCheck: true,
    routeOptions: options.routeOptions,
    providers: [SolanaProvider({ getWallet: async () => wallet.wallet })],
    rpcUrls: { [ChainId.SOL]: options.rpcUrls },
  })

// ---------------------------------------------------------------------------
// Routes and route updates
// ---------------------------------------------------------------------------

/**
 * A one-step route without `transactionRequest`, as `getRoutes` returns it,
 * so `PrepareTransactionTask` asks `/advanced/stepTransaction` for the
 * transaction. `kind: 'bridge'` goes from Solana to Ethereum.
 */
export const buildRoute = (
  network: FakeNetwork,
  fromAddress: Address,
  kind: 'swap' | 'bridge' = 'swap'
): Route => {
  const id = `solana-flow-${network.id}-${kind}`
  const toToken = kind === 'bridge' ? ETH_USDC_TOKEN : SOL_USDC_TOKEN
  const toAddress =
    kind === 'bridge'
      ? '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
      : fromAddress
  const tool = kind === 'bridge' ? 'mayan' : 'jupiter'
  const step = {
    id: `${id}-step`,
    type: 'lifi',
    tool,
    toolDetails: { key: tool, name: tool, logoURI: '' },
    action: {
      fromChainId: ChainId.SOL,
      toChainId: toToken.chainId,
      fromToken: SOL_TOKEN,
      toToken,
      fromAmount: FROM_AMOUNT,
      slippage: 0.005,
      fromAddress,
      toAddress,
    },
    estimate: {
      tool,
      fromAmount: FROM_AMOUNT,
      fromAmountUSD: '0.1',
      toAmount: ESTIMATED_TO_AMOUNT,
      toAmountMin: '99500',
      toAmountUSD: '0.1',
      approvalAddress: '',
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
    },
    includedSteps: [],
  } as unknown as LiFiStep
  return {
    id,
    fromChainId: ChainId.SOL,
    toChainId: toToken.chainId,
    fromAmount: FROM_AMOUNT,
    fromAmountUSD: '0.1',
    fromToken: SOL_TOKEN,
    toToken,
    toAmount: ESTIMATED_TO_AMOUNT,
    toAmountMin: '99500',
    toAmountUSD: '0.1',
    fromAddress,
    toAddress,
    gasCostUSD: '0',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

/** What a widget stores: the route after a JSON round trip. */
export const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

export interface RouteRecorder {
  /** Pass as `updateRouteHook`; stores a JSON snapshot of every update. */
  readonly updateRouteHook: (route: RouteExtended) => void
  readonly snapshots: RouteExtended[]
  /**
   * A new copy of the last snapshot, as a new read from storage gives:
   * `resumeRoute` changes its input, and must not change `snapshots`.
   * Throws when there is none.
   */
  latest(): RouteExtended
  /**
   * The actions of the first step as `TYPE:STATUS` (space-separated, in the
   * order the route holds them) for every update, with consecutive duplicates
   * and updates without actions removed: the state changes a user sees.
   */
  trail(): string[]
}

export const recordRoute = (): RouteRecorder => {
  const snapshots: RouteExtended[] = []
  return {
    snapshots,
    updateRouteHook: (route: RouteExtended): void => {
      snapshots.push(persist(route))
    },
    latest(): RouteExtended {
      const last = snapshots.at(-1)
      if (!last) {
        throw new Error('updateRouteHook was never called.')
      }
      return persist(last)
    },
    trail(): string[] {
      const trail: string[] = []
      for (const snapshot of snapshots) {
        const entry = (snapshot.steps[0].execution?.actions ?? [])
          .map((action) => `${action.type}:${action.status}`)
          .join(' ')
        if (entry && entry !== trail.at(-1)) {
          trail.push(entry)
        }
      }
      return trail
    },
  }
}
