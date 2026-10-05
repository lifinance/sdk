/**
 * Network-level harness for the Sui money-path flow specs
 * (`*.flow.spec.ts` beside this file).
 *
 * The specs drive the real SDK end to end: `executeRoute` / `resumeRoute` →
 * `SuiProvider.getStepExecutor` → the real `SuiStepExecutor` and its real
 * task pipeline. Only the network and the wallet key are fake:
 *
 * - The integrator client ({@link FakeSuiNetwork.integratorClient}, given to
 *   `SuiProvider({ getClient })`). `SuiSignAndExecuteTask` calls only
 *   `core.signAndExecuteTransaction` on it. That method is the real
 *   `@mysten/sui` `CoreClient` implementation (it builds the bytes, calls
 *   `signer.signTransaction`, then `this.executeTransaction`); only
 *   `executeTransaction` is fake. Its calls are recorded as `client.<name>`.
 * - Every `SuiGrpcClient` that `callSuiWithRetry` builds. This file mocks
 *   `@mysten/sui/grpc` (the rest of the module stays real): the class reads
 *   `core` and `ledgerService` from the installed network on every access,
 *   because `callSuiWithRetry` keeps its clients in a module-level map that
 *   no spec can reset. Its calls are recorded as `grpc.<name>` and
 *   `grpc.ledgerService.<name>`.
 * - The wallet: a real `Ed25519Keypair` (a new key per page), with
 *   `signTransaction` spied. Every hash and signature is real, and the fake
 *   node verifies each signature before it executes.
 * - `globalThis.fetch`: the LI.FI API (`/advanced/stepTransaction`, `/status`).
 *
 * Anything else (a method the fake does not implement, an unknown URL, an
 * invalid signature, a wait for an unknown digest) is recorded in
 * {@link FakeSuiNetwork.unexpected}, which every spec asserts is empty in
 * `afterEach`. Main swallows many errors (`callSuiWithRetry`, the `/status`
 * poll), so a throw alone could hide.
 *
 * Import this file before any other module that imports `@mysten/sui/grpc`
 * (the specs import only `@lifi/sdk`, `vitest` and this file).
 *
 * `.mock.ts` keeps this file out of `dist`.
 */
import {
  ChainId,
  ChainType,
  createClient,
  type ExtendedChain,
  type LiFiStep,
  type LiFiStepExtended,
  type Route,
  type RouteExtended,
  type SDKClient,
  type Token,
} from '@lifi/sdk'
import {
  type ClientWithCoreApi,
  CoreClient,
  formatMoveAbortMessage,
  type SuiClientTypes,
} from '@mysten/sui/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { type Mock, vi } from 'vitest'
import { SuiProvider } from '../../SuiProvider.js'

// ---------------------------------------------------------------------------
// The `@mysten/sui/grpc` mock
// ---------------------------------------------------------------------------

const grpc = vi.hoisted(() => ({
  core: undefined as unknown,
  ledgerService: undefined as unknown,
  /** `baseUrl` of every `SuiGrpcClient` built, in order. */
  built: [] as string[],
}))

vi.mock('@mysten/sui/grpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mysten/sui/grpc')>()),
  SuiGrpcClient: class SuiGrpcClient {
    constructor(options: { baseUrl: string }) {
      grpc.built.push(options.baseUrl)
    }
    get core(): unknown {
      return grpc.core
    }
    get ledgerService(): unknown {
      return grpc.ledgerService
    }
  },
}))

/**
 * `baseUrl` of every `SuiGrpcClient` built in this spec file, in order.
 * `callSuiWithRetry` builds one per RPC URL and keeps it for the whole file.
 */
export const suiGrpcClientsBuilt = (): string[] => [...grpc.built]

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const API_URL = 'https://api.lifi.test/v1'
/** The only Sui RPC URL, so `callSuiWithRetry` has exactly one client. */
export const SUI_RPC_URL = 'https://sui-rpc.test'
/** `fromChain.metamask.blockExplorerUrls[0]`: the provider's `txLink` base. */
export const SUI_EXPLORER_URL = 'https://suivision.test/'
/** The explorer the fake `/status` answer links to (not the provider's). */
export const STATUS_EXPLORER_URL = 'https://suiscan.test/'
export const ARB_EXPLORER_URL = 'https://arbiscan.test/'

/** What the fake chain holds for every wallet: 1000 SUI. */
export const SUI_BALANCE = '1000000000000'
/** `step.action.fromAmount`: 1 SUI. */
export const FROM_AMOUNT = '1000000000'
/** `step.estimate.toAmount` of every quote. */
export const ESTIMATED_TO_AMOUNT = '3000000'
/** What `/status` says arrived on Sui (same-chain swap). */
export const SWAP_RECEIVED_AMOUNT = '2999000'
/** What `/status` says arrived on Arbitrum (bridge). */
export const BRIDGE_RECEIVED_AMOUNT = '2990000'
/** `step.action.toAddress` of the bridge: an EVM wallet. */
export const BRIDGE_TO_ADDRESS = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

const GAS_COIN = `0x${'11'.repeat(32)}`
const GAS_COIN_DIGEST = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi'

export const SUI_TOKEN: Token = {
  address: '0x2::sui::SUI',
  chainId: ChainId.SUI,
  symbol: 'SUI',
  decimals: 9,
  name: 'SUI',
  priceUSD: '3',
  coinKey: 'SUI',
  logoURI: '',
} as Token

export const SUI_USDC_TOKEN: Token = {
  address:
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  chainId: ChainId.SUI,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as Token

export const ARB_USDC_TOKEN: Token = {
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  chainId: ChainId.ARB,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as Token

const SUI_CHAIN = {
  id: ChainId.SUI,
  key: 'sui',
  chainType: ChainType.MVM,
  name: 'Sui',
  coin: 'SUI',
  mainnet: true,
  logoURI: '',
  nativeToken: SUI_TOKEN,
  metamask: {
    chainId: '0x20ef8ac12ae000',
    chainName: 'Sui',
    nativeCurrency: { name: 'SUI', symbol: 'SUI', decimals: 9 },
    rpcUrls: [SUI_RPC_URL],
    blockExplorerUrls: [SUI_EXPLORER_URL],
  },
} as unknown as ExtendedChain

const ARB_CHAIN = {
  id: ChainId.ARB,
  key: 'arb',
  chainType: ChainType.EVM,
  name: 'Arbitrum',
  coin: 'ETH',
  mainnet: true,
  logoURI: '',
  metamask: {
    chainId: '0xa4b1',
    chainName: 'Arbitrum',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb-rpc.test'],
    blockExplorerUrls: [ARB_EXPLORER_URL],
  },
} as unknown as ExtendedChain

/**
 * Fully resolved transaction bytes (base64), as the API sends them in
 * `transactionRequest.data`: sender, gas data and an epoch expiration, so
 * building them needs no client. `variant` changes the split amount, so
 * every quote has its own digest.
 */
export const buildTransactionData = async (
  sender: string,
  variant: number
): Promise<string> => {
  const tx = new Transaction()
  tx.setSender(sender)
  tx.setGasPrice(1000)
  tx.setGasBudget(10_000_000)
  tx.setGasPayment([
    { objectId: GAS_COIN, version: '1', digest: GAS_COIN_DIGEST },
  ])
  tx.setExpiration({
    ValidDuring: {
      minEpoch: '1266',
      maxEpoch: '1267',
      minTimestamp: null,
      maxTimestamp: null,
      chain: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
      nonce: 1,
    },
  })
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(variant + 1)])
  tx.transferObjects([coin], tx.pure.address(sender))
  return toBase64(await tx.build())
}

/** The digest a node computes for base64 transaction bytes. */
export const digestOf = (bytes: string): string =>
  TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes))

/** The destination hash the fake `/status` reports for a bridge. */
export const destinationTxHashOf = (digest: string): string =>
  `0x${Array.from(fromBase58(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`

/** A Move abort, shaped as the gRPC core client parses it. */
export const MOVE_ABORT: SuiClientTypes.ExecutionError = {
  $kind: 'MoveAbort',
  message: formatMoveAbortMessage({
    command: 0,
    abortCode: '7',
    location: {
      package:
        '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
      module: 'pool',
      functionName: 'swap',
      instruction: 42,
    },
  }),
  command: 0,
  MoveAbort: {
    abortCode: '7',
    location: {
      package:
        '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
      module: 'pool',
      functionName: 'swap',
      instruction: 42,
    },
  },
}

/** What the fake wallet throws when the user rejects. */
export const USER_REJECTION_MESSAGE = 'User rejected the request.'

/**
 * A node error whose text contains "rejected". The text is made up:
 * `parseSuiErrors` only looks for the substring "reject".
 */
export const NODE_REJECTION_MESSAGE =
  'Transaction rejected by the validators (non-retriable).'

let routeCounter = 0

export type RouteKind = 'swap' | 'bridge'

/**
 * A one-step route as `/advanced/routes` returns it: no `transactionRequest`,
 * so the first run asks `/advanced/stepTransaction`. Route and step ids are
 * unique per call (execution state is keyed by route id).
 */
export const buildRoute = (kind: RouteKind, walletAddress: string): Route => {
  routeCounter += 1
  const bridge = kind === 'bridge'
  const toToken = bridge ? ARB_USDC_TOKEN : SUI_USDC_TOKEN
  const toAddress = bridge ? BRIDGE_TO_ADDRESS : walletAddress
  const tool = bridge ? 'mayan' : 'cetus'
  const step = {
    id: `sui-flow-step-${routeCounter}`,
    type: bridge ? 'cross' : 'swap',
    tool,
    toolDetails: { key: tool, name: tool, logoURI: '' },
    action: {
      fromChainId: ChainId.SUI,
      toChainId: toToken.chainId,
      fromToken: SUI_TOKEN,
      toToken,
      fromAmount: FROM_AMOUNT,
      slippage: 0.005,
      fromAddress: walletAddress,
      toAddress,
    },
    estimate: {
      tool,
      fromAmount: FROM_AMOUNT,
      fromAmountUSD: '3',
      toAmount: ESTIMATED_TO_AMOUNT,
      toAmountMin: '2985000',
      toAmountUSD: '3',
      approvalAddress: '',
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
    },
    includedSteps: [],
  } as unknown as LiFiStep
  return {
    id: `sui-flow-route-${routeCounter}`,
    fromChainId: ChainId.SUI,
    toChainId: toToken.chainId,
    fromAmount: FROM_AMOUNT,
    fromAmountUSD: '3',
    fromToken: SUI_TOKEN,
    toToken,
    toAmount: ESTIMATED_TO_AMOUNT,
    toAmountMin: '2985000',
    toAmountUSD: '3',
    fromAddress: walletAddress,
    toAddress,
    gasCostUSD: '0',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// Fake Sui network and LI.FI API
// ---------------------------------------------------------------------------

export interface ExecutedTransaction {
  /** Base64 of the executed transaction bytes. */
  bytes: string
  signatures: string[]
}

export interface FakeSuiNetwork {
  /** The integrator client (`SuiProvider({ getClient })`). */
  readonly integratorClient: ClientWithCoreApi
  /** `SuiGrpcClient.core` of the clients `callSuiWithRetry` builds. */
  readonly grpcCore: unknown
  /** `SuiGrpcClient.ledgerService` of the same clients. */
  readonly grpcLedgerService: unknown
  /** `executeTransaction` requests, in order: what reached the node. */
  readonly executed: ExecutedTransaction[]
  /** Every client, gRPC and `ledgerService` method called, in order. */
  readonly methods: string[]
  /** Calls and requests the fakes do not expect (must stay empty). */
  readonly unexpected: string[]
  /** Executed digests and their on-chain failure (`null` = success). */
  readonly landed: Map<string, SuiClientTypes.ExecutionError | null>
  /** Bodies of the `/advanced/stepTransaction` requests, in order. */
  readonly stepTransactionRequests: LiFiStep[]
  /** `transactionRequest.data` of each `/advanced/stepTransaction` answer. */
  readonly quotes: string[]
  /** Query parameters of each `/status` request, in order. */
  readonly statusRequests: Record<string, string>[]
  /** The next newly executed transaction fails on chain with this error. */
  failNextExecution: SuiClientTypes.ExecutionError | undefined
  /** The node refuses the next execution request with this error. */
  refuseNextExecution: Error | undefined
  fetch: typeof fetch
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

const transactionResult = (
  digest: string,
  signatures: string[],
  failure: SuiClientTypes.ExecutionError | null
): SuiClientTypes.TransactionResult => {
  const transaction = {
    digest,
    signatures,
    epoch: '1266',
    timestampMs: null,
    checkpoint: null,
    balanceChanges: undefined,
    effects: undefined,
    events: undefined,
    objectTypes: undefined,
    transaction: undefined,
    bcs: undefined,
  }
  return failure
    ? {
        $kind: 'FailedTransaction',
        FailedTransaction: {
          ...transaction,
          status: { success: false, error: failure },
        },
      }
    : {
        $kind: 'Transaction',
        Transaction: { ...transaction, status: { success: true, error: null } },
      }
}

let quoteCounter = 0

const createFakeSuiNetwork = (): FakeSuiNetwork => {
  const signaturesByDigest = new Map<string, string[]>()

  /**
   * An object whose every method call is recorded in `methods` as
   * `${prefix}${name}`. A method missing from `implemented` is recorded in
   * `unexpected` too, and throws. `core` answers the object itself, as
   * `CoreClient` does (`this.core = this`).
   */
  const recording = (
    prefix: string,
    implemented: Record<string, (...args: never[]) => unknown>
  ): Record<string, (...args: never[]) => unknown> => {
    const proxy: Record<string, (...args: never[]) => unknown> = new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== 'string' || property === 'then') {
            return undefined
          }
          if (property === 'core') {
            return proxy
          }
          const name = `${prefix}${property}`
          const method = implemented[property]
          return (...args: never[]) => {
            network.methods.push(name)
            if (!method) {
              network.unexpected.push(name)
              throw new Error(`Fake Sui network: ${name} is not implemented`)
            }
            return method(...args)
          }
        },
      }
    )
    return proxy
  }

  // What a node does with an execution request: verify the signature,
  // run the transaction once per digest, answer its effects status.
  const executeTransaction = async (options: {
    transaction: Uint8Array
    signatures: string[]
  }): Promise<SuiClientTypes.TransactionResult> => {
    const bytes = toBase64(options.transaction)
    network.executed.push({ bytes, signatures: [...options.signatures] })
    const refusal = network.refuseNextExecution
    if (refusal) {
      network.refuseNextExecution = undefined
      throw refusal
    }
    const sender = Transaction.from(options.transaction).getData().sender
    for (const signature of options.signatures) {
      try {
        await verifyTransactionSignature(options.transaction, signature, {
          address: sender ?? undefined,
        })
      } catch {
        network.unexpected.push(`invalid signature for ${digestOf(bytes)}`)
        throw new Error('Fake Sui node: invalid signature')
      }
    }
    const digest = digestOf(bytes)
    if (!network.landed.has(digest)) {
      network.landed.set(digest, network.failNextExecution ?? null)
      signaturesByDigest.set(digest, [...options.signatures])
      network.failNextExecution = undefined
    }
    return transactionResult(
      digest,
      signaturesByDigest.get(digest) ?? [],
      network.landed.get(digest) ?? null
    )
  }

  const integratorCore = recording('client.', {
    // The real `@mysten/sui` implementation, so the build, the sign call
    // and the hand-over to `executeTransaction` are the library's own.
    signAndExecuteTransaction: (options: never) =>
      CoreClient.prototype.signAndExecuteTransaction.call(
        integratorCore,
        options
      ),
    executeTransaction,
  })

  const grpcCore = recording('grpc.', {
    // Every wallet holds SUI_BALANCE of SUI and nothing else.
    async listBalances(): Promise<SuiClientTypes.ListBalancesResponse> {
      return {
        balances: [
          {
            coinType: SUI_TOKEN.address,
            balance: SUI_BALANCE,
            coinBalance: SUI_BALANCE,
            addressBalance: '0',
          },
        ],
        hasNextPage: false,
        cursor: null,
      }
    },
    // The transaction landed when the node executed it, so the first read
    // answers. An unknown digest would make main wait for minutes.
    async waitForTransaction(options: { digest: string }) {
      if (!network.landed.has(options.digest)) {
        network.unexpected.push(`wait for unknown digest ${options.digest}`)
        throw new Error(`Fake Sui network: unknown digest ${options.digest}`)
      }
      return transactionResult(
        options.digest,
        signaturesByDigest.get(options.digest) ?? [],
        network.landed.get(options.digest) ?? null
      )
    },
  })

  const ledgerService = recording('grpc.ledgerService.', {
    async getServiceInfo() {
      return { response: { checkpointHeight: 1000n } }
    },
  })

  const network: FakeSuiNetwork = {
    integratorClient: { core: integratorCore } as unknown as ClientWithCoreApi,
    grpcCore,
    grpcLedgerService: ledgerService,
    executed: [],
    methods: [],
    unexpected: [],
    landed: new Map(),
    stepTransactionRequests: [],
    quotes: [],
    statusRequests: [],
    failNextExecution: undefined,
    refuseNextExecution: undefined,
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      if (url === `${API_URL}/advanced/stepTransaction`) {
        const requested = JSON.parse(String(init?.body)) as LiFiStep
        network.stepTransactionRequests.push(requested)
        quoteCounter += 1
        const data = await buildTransactionData(
          requested.action.fromAddress as string,
          quoteCounter
        )
        network.quotes.push(data)
        return json({ ...requested, transactionRequest: { data } })
      }
      if (url.startsWith(`${API_URL}/status?`)) {
        const query = Object.fromEntries(new URL(url).searchParams)
        network.statusRequests.push(query)
        const txHash = query.txHash ?? ''
        if (!network.landed.has(txHash)) {
          // Main polls `/status` forever while the answer is not DONE, so
          // an unknown hash answers DONE without `receiving`: main then
          // fails at once instead of hanging.
          network.unexpected.push(`/status for unknown hash ${txHash}`)
          return json({ status: 'DONE', substatus: 'COMPLETED' })
        }
        return json(statusAnswer(txHash, Number(query.toChain)))
      }
      network.unexpected.push(`fetch ${url}`)
      return json({ message: `Unexpected request ${url}` }, 404)
    }) as typeof fetch,
  }
  return network
}

const statusAnswer = (txHash: string, toChainId: number) => {
  const bridge = toChainId !== ChainId.SUI
  const sending = {
    txHash,
    txLink: `${STATUS_EXPLORER_URL}tx/${txHash}`,
    chainId: ChainId.SUI,
    amount: FROM_AMOUNT,
    token: SUI_TOKEN,
    gasPrice: '1000',
    gasUsed: '2000000',
    gasToken: SUI_TOKEN,
    gasAmount: '2000000',
    gasAmountUSD: '0.006',
    timestamp: 1,
  }
  const receivingHash = bridge ? destinationTxHashOf(txHash) : txHash
  return {
    status: 'DONE',
    substatus: 'COMPLETED',
    tool: bridge ? 'mayan' : 'cetus',
    sending,
    receiving: {
      txHash: receivingHash,
      txLink: bridge
        ? `${ARB_EXPLORER_URL}tx/${receivingHash}`
        : `${STATUS_EXPLORER_URL}tx/${receivingHash}`,
      chainId: toChainId,
      amount: bridge ? BRIDGE_RECEIVED_AMOUNT : SWAP_RECEIVED_AMOUNT,
      token: bridge ? ARB_USDC_TOKEN : SUI_USDC_TOKEN,
      timestamp: 2,
    },
  }
}

/**
 * A new fake network for one spec: the `@mysten/sui/grpc` mock answers from
 * it, and `globalThis.fetch` is its LI.FI API. Undo with
 * `vi.unstubAllGlobals()` in `afterEach`.
 */
export const installFakeSuiNetwork = (): FakeSuiNetwork => {
  const network = createFakeSuiNetwork()
  grpc.core = network.grpcCore
  grpc.ledgerService = network.grpcLedgerService
  vi.stubGlobal('fetch', network.fetch)
  return network
}

// ---------------------------------------------------------------------------
// One "page": a wallet, a provider and an SDK client
// ---------------------------------------------------------------------------

export interface Page {
  client: SDKClient
  /** The wallet key's `signTransaction`, spied (it still signs). */
  signTransaction: Mock
  walletAddress: string
}

/** A new page with a new wallet key, so every digest is unique. */
export const openPage = (network: FakeSuiNetwork): Page => {
  const signer = Ed25519Keypair.generate()
  const signTransaction = vi.spyOn(signer, 'signTransaction') as Mock
  const provider = SuiProvider({
    getClient: async () => network.integratorClient,
    getSigner: async () => signer,
  })
  const client = createClient({
    integrator: 'sui-flow-specs',
    apiUrl: API_URL,
    preloadChains: false,
    disableVersionCheck: true,
    providers: [provider],
    rpcUrls: { [ChainId.SUI]: [SUI_RPC_URL] },
  })
  client.setChains([SUI_CHAIN, ARB_CHAIN])
  return { client, signTransaction, walletAddress: signer.toSuiAddress() }
}

/** The user rejects the next signature request of this page's wallet. */
export const rejectNextSignature = (page: Page): void => {
  page.signTransaction.mockRejectedValueOnce(new Error(USER_REJECTION_MESSAGE))
}

/** Base64 of the bytes passed to each `signTransaction` call, in order. */
export const signedBytes = (page: Page): string[] =>
  page.signTransaction.mock.calls.map(([bytes]) =>
    toBase64(bytes as Uint8Array)
  )

/** The signature each settled `signTransaction` call returned, in order. */
export const signatures = async (page: Page): Promise<string[]> => {
  const settled = await Promise.allSettled(
    page.signTransaction.mock.results.map((result) => result.value)
  )
  return settled.flatMap((result) =>
    result.status === 'fulfilled'
      ? [(result.value as { signature: string }).signature]
      : []
  )
}

// ---------------------------------------------------------------------------
// Route updates as the widget sees them
// ---------------------------------------------------------------------------

export interface RouteUpdates {
  /** Pass as `updateRouteHook`. */
  readonly hook: (route: RouteExtended) => void
  /** A JSON copy of the route at every hook call (what storage holds). */
  readonly snapshots: RouteExtended[]
  /**
   * `${action type}:${status}` each time an action appears or changes its
   * status between two hook calls, in order: the state changes a user sees.
   */
  readonly changes: string[]
}

export const recordRouteUpdates = (): RouteUpdates => {
  let previous = new Map<string, string>()
  const updates: RouteUpdates = {
    snapshots: [],
    changes: [],
    hook: (route) => {
      const snapshot = JSON.parse(JSON.stringify(route)) as RouteExtended
      updates.snapshots.push(snapshot)
      const current = new Map<string, string>()
      for (const step of snapshot.steps) {
        for (const action of step.execution?.actions ?? []) {
          current.set(action.type, action.status)
          if (previous.get(action.type) !== action.status) {
            updates.changes.push(`${action.type}:${action.status}`)
          }
        }
      }
      previous = current
    },
  }
  return updates
}

/** The step of a one-step route. */
export const stepOf = (route: RouteExtended): LiFiStepExtended => route.steps[0]
