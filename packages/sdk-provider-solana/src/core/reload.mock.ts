/**
 * Fixtures for the Solana reload specs (`reload.unit.spec.ts`).
 *
 * The specs drive the public entry points (`executeRoute`, `resumeRoute`) with
 * the real `SolanaStepExecutor`, the real pipeline and the real `@solana/kit`
 * RPC client. The one seam is `globalThis.fetch`: `@solana/kit`'s HTTP
 * transport and the LI.FI API client both call it, so a single fake answers
 * the Solana JSON-RPC methods and the `/advanced/stepTransaction` and
 * `/status` endpoints. Nothing inside the provider is mocked, so the specs do
 * not depend on how the resume path is split into modules.
 *
 * `.mock.ts` keeps this file out of `dist` (tsdown entry, tsconfig exclude,
 * package.json `files`).
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
import {
  type Address,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import type { Wallet } from '@wallet-standard/base'
import { type Mock, vi } from 'vitest'
import { SolanaProvider } from '../SolanaProvider.js'
import { KeypairWalletAdapter } from '../utils/KeypairWalletAdapter.js'

export const API_URL = 'https://api.lifi.test/v1'
export const SOLANA_RPC_URLS: string[] = [
  'https://rpc-a.solana.test/',
  'https://rpc-b.solana.test/',
]

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const BLOCKHASH = blockhash(
  getBase58Decoder().decode(new Uint8Array(32).fill(7))
)
/**
 * The head of every fake node, a mainnet-sized slot. A bounded lookup places
 * its history canary `ceil(age / 400)` slots below the lowest current slot
 * (spec 4.2.8); a slot this high keeps that bound positive.
 */
const CURRENT_SLOT = 300_000_000
const BLOCK_HEIGHT = 280_000_000
/** No code path reads it: the wire format carries only the blockhash. */
const LAST_VALID_BLOCK_HEIGHT = BLOCK_HEIGHT + 150

/** The 60 marker bytes of a canary signature; the last 4 bytes hold its slot. */
const CANARY_BYTE = 9

/**
 * The canary of the block at `slot`: a transaction that landed in that block
 * long before the test. Every fake node has every block, so every fake node
 * knows every canary, at the slot of its block - which is what a bounded
 * lookup checks (spec 4.2.8).
 */
const canaryAt = (slot: number): string => {
  const bytes = new Uint8Array(64).fill(CANARY_BYTE)
  new DataView(bytes.buffer).setUint32(60, slot)
  return getBase58Decoder().decode(bytes)
}

/** The block slot of a canary signature; `undefined` for any other one. */
const canarySlotOf = (signature: string): number | undefined => {
  const bytes = Uint8Array.from(getBase58Encoder().encode(signature))
  if (
    bytes.length !== 64 ||
    bytes.subarray(0, 60).some((byte) => byte !== CANARY_BYTE)
  ) {
    return undefined
  }
  return new DataView(bytes.buffer).getUint32(60)
}

const SOL_TOKEN = {
  address: '11111111111111111111111111111111',
  chainId: ChainId.SOL,
  symbol: 'SOL',
  decimals: 9,
  name: 'SOL',
  priceUSD: '100',
  coinKey: 'SOL',
  logoURI: '',
} as unknown as Token

const USDC_TOKEN = {
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  chainId: ChainId.SOL,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '1',
  coinKey: 'USDC',
  logoURI: '',
} as unknown as Token

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
    rpcUrls: SOLANA_RPC_URLS,
    blockExplorerUrls: ['https://solscan.test/'],
  },
} as unknown as ExtendedChain

/** An unsigned single transaction, base64 wire format, as the backend sends it. */
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

/** The fee payer signature of a base64 wire transaction. */
export const signatureOf = (wireTransaction: string): string =>
  getSignatureFromTransaction(
    getTransactionDecoder().decode(getBase64Encoder().encode(wireTransaction))
  )

export const buildStep = (walletAddress: Address): LiFiStepExtended =>
  ({
    id: 'reload-step',
    type: 'lifi',
    tool: 'jupiter',
    toolDetails: { key: 'jupiter', name: 'Jupiter', logoURI: '' },
    action: {
      fromChainId: ChainId.SOL,
      toChainId: ChainId.SOL,
      fromToken: SOL_TOKEN,
      toToken: USDC_TOKEN,
      fromAmount: '1000000',
      slippage: 0.005,
      fromAddress: walletAddress,
      toAddress: walletAddress,
    },
    estimate: {
      fromAmount: '1000000',
      fromAmountUSD: '0.1',
      toAmount: '100000',
      toAmountMin: '99500',
      toAmountUSD: '0.1',
      approvalAddress: '',
      executionDuration: 30,
      feeCosts: [],
      gasCosts: [],
      tool: 'jupiter',
    },
    includedSteps: [],
    transactionRequest: {
      data: buildUnsignedTransaction(walletAddress, 'reload quote 0'),
    },
  }) as unknown as LiFiStepExtended

let routeCounter = 0

/** A one-step route with a unique id (execution state is keyed by route id). */
export const buildRoute = (step: LiFiStepExtended): Route => {
  routeCounter += 1
  return {
    id: `solana-reload-route-${routeCounter}`,
    fromChainId: ChainId.SOL,
    toChainId: ChainId.SOL,
    fromAmount: step.action.fromAmount,
    fromAmountUSD: '0.1',
    fromToken: SOL_TOKEN,
    toToken: USDC_TOKEN,
    toAmount: step.estimate.toAmount,
    toAmountMin: step.estimate.toAmountMin,
    toAmountUSD: '0.1',
    fromAddress: step.action.fromAddress,
    toAddress: step.action.fromAddress,
    gasCostUSD: '0',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// Fake network: Solana JSON-RPC and the LI.FI API behind one `fetch`
// ---------------------------------------------------------------------------

export interface FakeNetwork {
  /** Base64 wire transactions received by `sendTransaction`, in order. */
  readonly sent: string[]
  /** Every JSON-RPC method that was called, in order. */
  readonly methods: string[]
  /** JSON-RPC methods the fake does not implement (must stay empty). */
  readonly unsupported: string[]
  /** Included signatures and their on-chain error (`null` = success). */
  readonly landed: Map<string, unknown>
  /** On-chain error for the next newly included transaction. */
  failNext: unknown
  /** Requests to `/advanced/stepTransaction`. */
  stepTransactionRequests: number
  /** `'no-receiving'` makes `/status` answer DONE without `receiving`. */
  statusMode: 'done' | 'no-receiving'
  /**
   * Called when a `sendTransaction` request arrives, before the fake includes
   * the transaction. Lets a spec snapshot the route at that instant.
   */
  onSend?: (wireTransaction: string) => void
  /** Forgets what the chain saw: the page closed before the send arrived. */
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

export const createFakeNetwork = (): FakeNetwork => {
  let quoteCounter = 0
  const network: FakeNetwork = {
    sent: [],
    methods: [],
    unsupported: [],
    landed: new Map<string, unknown>(),
    failNext: undefined,
    stepTransactionRequests: 0,
    statusMode: 'done',
    onSend: undefined,
    forgetChain() {
      network.landed.clear()
    },
    clearRecords() {
      network.sent.length = 0
      network.methods.length = 0
      network.stepTransactionRequests = 0
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      if (SOLANA_RPC_URLS.some((rpcUrl) => url.startsWith(rpcUrl))) {
        const request = JSON.parse(String(init?.body)) as {
          id: number
          method: string
          params: unknown[]
        }
        network.methods.push(request.method)
        const result = answerRpc(network, request.method, request.params)
        if (result === UNSUPPORTED) {
          network.unsupported.push(request.method)
          return json({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Method not found' },
          })
        }
        return json({ jsonrpc: '2.0', id: request.id, result })
      }
      if (url.startsWith(`${API_URL}/advanced/stepTransaction`)) {
        network.stepTransactionRequests += 1
        quoteCounter += 1
        const requested = JSON.parse(String(init?.body)) as LiFiStep
        return json({
          ...requested,
          transactionRequest: {
            data: buildUnsignedTransaction(
              requested.action.fromAddress as Address,
              `reload quote ${quoteCounter}`
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

const UNSUPPORTED = Symbol('unsupported')

const signatureStatus = (
  err: unknown,
  slot: number = CURRENT_SLOT,
  confirmationStatus: 'confirmed' | 'finalized' = 'confirmed'
) => ({
  slot,
  confirmations: null,
  err,
  confirmationStatus,
  status: err ? { Err: err } : { Ok: null },
})

/**
 * The canary answers (`getSlot`, `getBlock`, the canary entries of
 * `getSignatureStatuses`) only keep the fake realistic. No spec here runs a
 * bounded lookup, so no `null` in these specs proves absence: the first look
 * of a resume asks for the target alone, and `resolveUnconfirmed` stops before
 * its lookup while `isBlockhashValid` answers `true` and `signedAt` is fresh.
 */
const answerRpc = (
  network: FakeNetwork,
  method: string,
  params: unknown[]
): unknown => {
  const context = { slot: CURRENT_SLOT }
  switch (method) {
    case 'simulateTransaction':
      return {
        context,
        value: {
          err: null,
          logs: [],
          accounts: null,
          unitsConsumed: 1,
          returnData: null,
        },
      }
    case 'sendTransaction': {
      const wire = params[0] as string
      network.onSend?.(wire)
      network.sent.push(wire)
      const signature = signatureOf(wire)
      if (!network.landed.has(signature)) {
        network.landed.set(signature, network.failNext ?? null)
        network.failNext = undefined
      }
      return signature
    }
    case 'getSignatureStatuses': {
      // `[target]`, or `[target, historyCanary, headCanary]` for a bounded
      // lookup (spec 4.2.8).
      const signatures = params[0] as string[]
      return {
        context,
        value: signatures.map((signature) => {
          const canarySlot = canarySlotOf(signature)
          if (canarySlot !== undefined) {
            return signatureStatus(null, canarySlot, 'finalized')
          }
          return network.landed.has(signature)
            ? signatureStatus(network.landed.get(signature))
            : null
        }),
      }
    }
    case 'getTransaction': {
      const signature = params[0] as string
      if (!network.landed.has(signature)) {
        return null
      }
      return {
        slot: CURRENT_SLOT,
        blockTime: 1,
        meta: { err: network.landed.get(signature), fee: 5000 },
        transaction: { signatures: [signature] },
      }
    }
    case 'isBlockhashValid':
      return { context, value: true }
    case 'getLatestBlockhash':
      return {
        context,
        value: {
          blockhash: BLOCKHASH,
          lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
        },
      }
    case 'getSlot':
      return CURRENT_SLOT
    case 'getBlockHeight':
      return BLOCK_HEIGHT
    case 'getBlock': {
      // The history canary block and the head canary block (`commitment:
      // 'confirmed'`) get the same answer: every fake block is confirmed.
      const slot = Number(params[0])
      return {
        blockhash: BLOCKHASH,
        previousBlockhash: BLOCKHASH,
        parentSlot: slot - 1,
        blockHeight: BLOCK_HEIGHT,
        blockTime: 1,
        signatures: [canaryAt(slot)],
      }
    }
    default:
      return UNSUPPORTED
  }
}

const statusAnswer = (mode: FakeNetwork['statusMode'], txHash: string) => {
  const sending = {
    txHash,
    txLink: `https://solscan.test/tx/${txHash}`,
    chainId: ChainId.SOL,
    amount: '1000000',
    token: SOL_TOKEN,
    gasPrice: '1',
    gasUsed: '1',
    gasToken: SOL_TOKEN,
    gasAmount: '5000',
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
    tool: 'jupiter',
    sending,
    receiving: {
      txHash,
      txLink: `https://solscan.test/tx/${txHash}`,
      chainId: ChainId.SOL,
      amount: '100000',
      token: USDC_TOKEN,
      timestamp: 2,
    },
  }
}

// ---------------------------------------------------------------------------
// One "page": a wallet, a provider and a client
// ---------------------------------------------------------------------------

export interface Page {
  client: SDKClient
  /** The wallet's `solana:signTransaction`, spied. */
  signTransaction: Mock
  walletAddress: Address
}

/**
 * Builds what one page load builds: a connected wallet, a `SolanaProvider`
 * and a client. A reload is a second `openPage` with the same key.
 */
export const openPage = async (secretKey: string): Promise<Page> => {
  const adapter = new KeypairWalletAdapter(secretKey)
  await adapter.connect()
  const feature = adapter.features[SolanaSignTransaction]
  const signTransaction = vi.fn(feature.signTransaction)
  const wallet = {
    version: adapter.version,
    name: adapter.name,
    icon: adapter.icon,
    chains: adapter.chains,
    accounts: [...adapter.accounts],
    features: { [SolanaSignTransaction]: { ...feature, signTransaction } },
  } as unknown as Wallet

  const base = SolanaProvider({ getWallet: async () => wallet })
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
    rpcUrls: { [ChainId.SOL]: SOLANA_RPC_URLS },
  })
  client.setChains([SOLANA_CHAIN])

  return {
    client,
    signTransaction,
    walletAddress: adapter.accounts[0].address as Address,
  }
}

/** Widget persistence: what `updateRouteHook` wrote to storage. */
export const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

export const swapActionOf = (
  route: RouteExtended
): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')
