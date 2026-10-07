/**
 * Fixtures for the Sui reload specs (`reload.unit.spec.ts`).
 *
 * The specs drive `executeRoute` / `resumeRoute` with the real
 * `SuiStepExecutor` and the real pipeline. The seams are at the network
 * boundary:
 *
 * - One fake Core API client ({@link FakeSuiNetwork.client}). It is the
 *   integrator client (`SuiProvider({ getClient })`) and, through the spec's
 *   `vi.mock('@mysten/sui/grpc')`, the `core` of every `SuiGrpcClient` that
 *   `callSuiWithRetry` builds. So a lookup, an execution or a wait answers
 *   the same, whichever client the provider uses for it.
 * - One fake `ledgerService` ({@link FakeSuiNetwork.ledgerService}), the
 *   `ledgerService` of every such `SuiGrpcClient`.
 * - `globalThis.fetch`: the LI.FI API (`/advanced/stepTransaction`, `/status`).
 *
 * The fake answers `executeTransaction`, `getTransaction`,
 * `waitForTransaction` and `signAndExecuteTransaction` (the pre-change path),
 * plus `ledgerService.batchGetTransactions` and `ledgerService.getCheckpoint`,
 * and records any other method in `unsupported`.
 *
 * The shared offline fixture (`suiSignedTransaction.unit.mock.ts`) does not
 * fit here: its signature is fake, and its bytes are the same for every quote.
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
import { type ClientWithCoreApi, TransactionError } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import { GrpcTypes, RpcError } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { type Mock, vi } from 'vitest'
import { SuiProvider } from '../SuiProvider.js'

export const API_URL = 'https://api.lifi.test/v1'
export const SUI_RPC_URLS: string[] = ['https://sui-a.test']

const GAS_COIN = `0x${'11'.repeat(32)}`
const GAS_COIN_DIGEST = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi'

const SUI_TOKEN = {
  address: '0x2::sui::SUI',
  chainId: ChainId.SUI,
  symbol: 'SUI',
  decimals: 9,
  name: 'SUI',
  priceUSD: '3',
  coinKey: 'SUI',
  logoURI: '',
} as unknown as Token

const USDC_TOKEN = {
  address:
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  chainId: ChainId.SUI,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as unknown as Token

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
    rpcUrls: SUI_RPC_URLS,
    blockExplorerUrls: ['https://suivision.test/'],
  },
} as unknown as ExtendedChain

/**
 * Fully resolved transaction bytes (base64), as the backend sends them in
 * `transactionRequest.data`: sender, gas data and the epoch expiration.
 * Building them needs no client. `variant` changes the split amount, so
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

export const buildStep = async (
  walletAddress: string
): Promise<LiFiStepExtended> =>
  ({
    id: 'reload-step',
    type: 'lifi',
    tool: 'cetus',
    toolDetails: { key: 'cetus', name: 'Cetus', logoURI: '' },
    action: {
      fromChainId: ChainId.SUI,
      toChainId: ChainId.SUI,
      fromToken: SUI_TOKEN,
      toToken: USDC_TOKEN,
      fromAmount: '1000000000',
      slippage: 0.005,
      fromAddress: walletAddress,
      toAddress: walletAddress,
    },
    estimate: {
      fromAmount: '1000000000',
      fromAmountUSD: '3',
      toAmount: '3000000',
      toAmountMin: '2985000',
      toAmountUSD: '3',
      approvalAddress: '',
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
      tool: 'cetus',
    },
    includedSteps: [],
    transactionRequest: { data: await buildTransactionData(walletAddress, 0) },
  }) as unknown as LiFiStepExtended

let routeCounter = 0

/** A one-step route with a unique id (execution state is keyed by route id). */
export const buildRoute = (step: LiFiStepExtended): Route => {
  routeCounter += 1
  return {
    id: `sui-reload-route-${routeCounter}`,
    fromChainId: ChainId.SUI,
    toChainId: ChainId.SUI,
    fromAmount: step.action.fromAmount,
    fromAmountUSD: '3',
    fromToken: SUI_TOKEN,
    toToken: USDC_TOKEN,
    toAmount: step.estimate.toAmount,
    toAmountMin: step.estimate.toAmountMin,
    toAmountUSD: '3',
    fromAddress: step.action.fromAddress,
    toAddress: step.action.fromAddress,
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
  /** The Core API client every Sui call of the provider goes through. */
  readonly client: ClientWithCoreApi
  /**
   * `SuiGrpcClient.ledgerService` of the LI.FI gRPC clients: the batch
   * transaction lookup and the checkpoints of the canary search
   * answer from the same fake chain.
   */
  readonly ledgerService: {
    batchGetTransactions(input: { digests: string[] }): Promise<unknown>
    getCheckpoint(input: {
      checkpointId: { oneofKind?: string; sequenceNumber?: bigint }
    }): Promise<unknown>
  }
  /** `executeTransaction` requests, in order. */
  readonly executed: ExecutedTransaction[]
  /** Every Core API and `ledgerService` method that was called, in order. */
  readonly methods: string[]
  /** Methods the fake does not implement (must stay empty). */
  readonly unsupported: string[]
  /** Executed digests and their failure (`null` = success). */
  readonly landed: Map<string, unknown>
  /** Execution failure for the next newly executed transaction. */
  failNext: unknown
  /** Requests to `/advanced/stepTransaction`. */
  stepTransactionRequests: number
  /** `'no-receiving'` makes `/status` answer DONE without `receiving`. */
  statusMode: 'done' | 'no-receiving'
  /** Called when an execution request arrives, before the fake runs it. */
  onExecute?: (transaction: ExecutedTransaction) => void
  /** Forgets what the chain saw: the page closed before the execution. */
  forgetChain(): void
  /** Clears the call records, keeps the chain state. */
  clearRecords(): void
  fetch: typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * What `GET /v1/status` answers for a hash LI.FI never saw: HTTP 404 with
 * body code 1003, never a `NOT_FOUND` status. `isKnownToStatusApi` reads it
 * as "no information" (false); only an HTTP 200 answer vetoes "dropped".
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

const transactionResult = (digest: string, failure: unknown) =>
  failure
    ? {
        $kind: 'FailedTransaction',
        FailedTransaction: {
          digest,
          epoch: '1266',
          status: { success: false, error: failure },
        },
      }
    : {
        $kind: 'Transaction',
        Transaction: {
          digest,
          epoch: '1266',
          status: { success: true, error: null },
        },
      }

/**
 * The fake chain makes one checkpoint per interval, and its tip is the
 * checkpoint of the current time. So the chain is never past the latest
 * landing time of a transaction signed during a spec: the "dropped" verdict
 * stays open.
 */
const CHECKPOINT_INTERVAL_MS = 250

/** Transaction `index` of checkpoint `sequenceNumber`, a 32-byte digest. */
const checkpointTransactionDigest = (
  sequenceNumber: bigint,
  index: number
): string => {
  const digest = new Uint8Array(32)
  new DataView(digest.buffer).setBigUint64(0, sequenceNumber)
  digest[31] = index + 1
  return toBase58(digest)
}

export const createFakeSuiNetwork = (): FakeSuiNetwork => {
  let quoteCounter = 0
  // Transactions of other users, in the checkpoints the fake answered.
  const checkpointTransactions = new Set<string>()

  const execute = async (options: {
    transaction: Uint8Array
    signatures: string[]
    signal?: AbortSignal
  }) => {
    const request = {
      bytes: toBase64(options.transaction),
      signatures: [...options.signatures],
    }
    network.onExecute?.(request)
    network.executed.push(request)
    const digest = TransactionDataBuilder.getDigestFromBytes(
      options.transaction
    )
    if (!network.landed.has(digest)) {
      network.landed.set(digest, network.failNext ?? null)
      network.failNext = undefined
    }
    return transactionResult(digest, network.landed.get(digest))
  }

  const getTransaction = async (options: { digest: string }) => {
    if (!network.landed.has(options.digest)) {
      // What the gRPC Core client throws for an unknown digest.
      throw new TransactionError('notFound', options.digest)
    }
    return transactionResult(options.digest, network.landed.get(options.digest))
  }

  /**
   * An object whose every method call is recorded in `methods` as
   * `${prefix}${name}`. A method missing from `implemented` is recorded in
   * `unsupported` too, and throws.
   */
  const recording = (
    prefix: string,
    implemented: Record<string, (...args: never[]) => unknown>
  ): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== 'string' || property === 'then') {
            return undefined
          }
          const name = `${prefix}${property}`
          const method = implemented[property]
          return (...args: never[]) => {
            network.methods.push(name)
            if (!method) {
              network.unsupported.push(name)
              throw new Error(`Fake Sui client: ${name} is not implemented`)
            }
            return method(...args)
          }
        },
      }
    )

  const core = recording('', {
    executeTransaction: execute,
    getTransaction,
    async waitForTransaction(options: {
      digest?: string
      result?: Record<string, { digest: string }>
      timeout?: number
    }) {
      const digest =
        options.digest ??
        Object.values(options.result ?? {}).find((value) => value?.digest)
          ?.digest
      const deadline = Date.now() + Math.min(options.timeout ?? 60_000, 1_000)
      while (Date.now() < deadline) {
        if (digest && network.landed.has(digest)) {
          return getTransaction({ digest })
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
    // The pre-change path: `@mysten/sui` CoreClient's own implementation.
    async signAndExecuteTransaction(options: {
      transaction: Transaction | Uint8Array
      signer: Signer
    }) {
      let bytes: Uint8Array
      if (options.transaction instanceof Uint8Array) {
        bytes = options.transaction
      } else {
        options.transaction.setSenderIfNotSet(options.signer.toSuiAddress())
        bytes = await options.transaction.build({ client: network.client })
      }
      const { signature } = await options.signer.signTransaction(bytes)
      return execute({ transaction: bytes, signatures: [signature] })
    },
  })

  const ledgerService = recording('ledgerService.', {
    // One request, one result per digest; an unknown digest is a per-item
    // google.rpc.Status with code 5 (NOT_FOUND), as on mainnet.
    async batchGetTransactions(input: { digests: string[] }) {
      return {
        response: {
          transactions: input.digests.map((digest) =>
            network.landed.has(digest) || checkpointTransactions.has(digest)
              ? {
                  result: {
                    oneofKind: 'transaction',
                    transaction: { digest, checkpoint: 1n },
                  },
                }
              : {
                  result: {
                    oneofKind: 'error',
                    error: {
                      code: 5,
                      message: `Transaction ${digest} not found`,
                      details: [],
                    },
                  },
                }
          ),
        },
      }
    },
    // Without `sequenceNumber`, the tip. Each checkpoint holds the consensus
    // commit prologue and one user transaction.
    async getCheckpoint(input: {
      checkpointId: { oneofKind?: string; sequenceNumber?: bigint }
    }) {
      const tip = BigInt(Math.floor(Date.now() / CHECKPOINT_INTERVAL_MS))
      const sequenceNumber =
        input.checkpointId.oneofKind === 'sequenceNumber'
          ? (input.checkpointId.sequenceNumber ?? tip)
          : tip
      if (sequenceNumber > tip) {
        throw new RpcError(
          `Checkpoint ${sequenceNumber} not found`,
          'NOT_FOUND'
        )
      }
      const timestampMs = Number(sequenceNumber) * CHECKPOINT_INTERVAL_MS
      const transactions = [
        GrpcTypes.TransactionKind_Kind.CONSENSUS_COMMIT_PROLOGUE_V4,
        GrpcTypes.TransactionKind_Kind.PROGRAMMABLE_TRANSACTION,
      ].map((kind, index) => {
        const digest = checkpointTransactionDigest(sequenceNumber, index)
        checkpointTransactions.add(digest)
        return { digest, transaction: { kind: { kind } } }
      })
      return {
        response: {
          checkpoint: {
            sequenceNumber,
            summary: {
              timestamp: {
                seconds: BigInt(Math.floor(timestampMs / 1000)),
                nanos: (timestampMs % 1000) * 1_000_000,
              },
            },
            transactions,
          },
        },
      }
    },
  })

  const network: FakeSuiNetwork = {
    client: { core } as unknown as ClientWithCoreApi,
    ledgerService: ledgerService as FakeSuiNetwork['ledgerService'],
    executed: [],
    methods: [],
    unsupported: [],
    landed: new Map<string, unknown>(),
    failNext: undefined,
    stepTransactionRequests: 0,
    statusMode: 'done',
    onExecute: undefined,
    forgetChain() {
      network.landed.clear()
    },
    clearRecords() {
      network.executed.length = 0
      network.methods.length = 0
      network.stepTransactionRequests = 0
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.startsWith(`${API_URL}/advanced/stepTransaction`)) {
        network.stepTransactionRequests += 1
        quoteCounter += 1
        const requested = JSON.parse(String(init?.body)) as LiFiStep
        return json({
          ...requested,
          transactionRequest: {
            data: await buildTransactionData(
              requested.action.fromAddress as string,
              quoteCounter
            ),
          },
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

const statusAnswer = (mode: FakeSuiNetwork['statusMode'], txHash: string) => {
  const sending = {
    txHash,
    txLink: `https://suivision.test/txblock/${txHash}`,
    chainId: ChainId.SUI,
    amount: '1000000000',
    token: SUI_TOKEN,
    gasPrice: '1000',
    gasUsed: '1',
    gasToken: SUI_TOKEN,
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
    tool: 'cetus',
    sending,
    receiving: {
      txHash,
      txLink: `https://suivision.test/txblock/${txHash}`,
      chainId: ChainId.SUI,
      amount: '3000000',
      token: USDC_TOKEN,
      timestamp: 2,
    },
  }
}

// ---------------------------------------------------------------------------
// One "page": a signer, a provider and a client
// ---------------------------------------------------------------------------

export interface Page {
  client: SDKClient
  /** The signer's `signTransaction`, spied. */
  signTransaction: Mock
  walletAddress: string
}

/** A reload is a second `openPage` with the same key. */
export const openPage = (network: FakeSuiNetwork, secretKey: string): Page => {
  const signer = Ed25519Keypair.fromSecretKey(secretKey)
  const signTransaction = vi.spyOn(signer, 'signTransaction') as Mock

  const base = SuiProvider({
    getClient: async () => network.client,
    getSigner: async () => signer,
  })
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
    rpcUrls: { [ChainId.SUI]: SUI_RPC_URLS },
  })
  client.setChains([SUI_CHAIN])
  return { client, signTransaction, walletAddress: signer.toSuiAddress() }
}

export const newSecretKey = (): string =>
  Ed25519Keypair.generate().getSecretKey()

/** The bytes and the signature the signer produced in a page's first run. */
export const signedBy = async (page: Page): Promise<ExecutedTransaction> => {
  const [bytes] = page.signTransaction.mock.calls[0] as [Uint8Array]
  const { signature } = (await page.signTransaction.mock.results[0].value) as {
    signature: string
  }
  return { bytes: toBase64(bytes), signatures: [signature] }
}

/** Widget persistence: what `updateRouteHook` wrote to storage. */
export const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

export const swapActionOf = (
  route: RouteExtended
): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')
