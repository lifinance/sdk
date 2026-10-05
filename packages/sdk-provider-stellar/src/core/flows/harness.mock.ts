/**
 * Network-level harness for the Stellar money-path flow specs
 * (`*.flow.spec.ts` beside this file).
 *
 * The specs drive the real SDK end to end: `executeRoute` / `resumeRoute` →
 * `StellarProvider.getStepExecutor` → the real `StellarStepExecutor` and its
 * real task pipeline. Only the network and the wallet key are fake:
 *
 * - Stellar RPC. The provider reads and writes only through the
 *   `@stellar/stellar-sdk/rpc` `Server` (Soroban RPC JSON-RPC; no Horizon).
 *   In `@stellar/stellar-sdk` 17 that `Server` uses the feaxios fetch
 *   client, which calls the global `fetch` at request time. So
 *   `globalThis.fetch` is the seam, also for the `Server` instances that
 *   `getStellarRpc.ts` keeps in a module-level map that no spec can reset.
 *   The fake parses each JSON-RPC body and answers from an in-memory chain:
 *   account sequence numbers, SAC allowances, landed transactions and a
 *   ledger counter. Every account holds {@link TOKEN_BALANCE} of every token.
 *   The SAC `approve` simulation answers the auth entry a node records for
 *   it (source-account credentials), and the chain lands an `approve` only
 *   with that entry, as a ledger that runs `from.require_auth()` does.
 * - The wallet: a real `Keypair` (a new key per page) behind a
 *   `StellarWallet` whose `signTransaction` is a spy that really signs the
 *   envelope, as the Stellar Wallets Kit does. The fake node verifies the
 *   signature and the sequence number of every envelope it receives.
 * - The LI.FI API on the same `fetch`: `/advanced/stepTransaction` builds a
 *   real envelope with `TransactionBuilder` from the live sequence number of
 *   the sender (as the backend does), and `/status` answers DONE for a hash
 *   that landed.
 *
 * Anything else (an unknown URL or JSON-RPC method, a contract function the
 * fake does not know, an invalid signature, an `approve` without its auth
 * entry, a `getTransaction` for a hash the node never received, a `/status`
 * request for a hash that did not land) is recorded in
 * {@link FakeStellarNetwork.unexpected}, which every spec asserts is empty
 * in `afterEach`. Main swallows many errors (`callStellarRpcsWithRetry`,
 * the confirmation poll, the `/status` poll), so a throw alone could hide.
 * So a throw inside the fakes is recorded too (`harness error: …`): the RPC
 * then answers a JSON-RPC error (-32603), and a LI.FI API request rejects.
 * `getTransaction` for a hash that the node received but that did not land
 * answers NOT_FOUND, as a node does: the provider then sleeps 3 s and polls
 * again, so a spec that reaches it without fake timers fails by the test
 * timeout.
 *
 * Closed state: when this file loads, it replaces the real `fetch` with one
 * that rejects every request and reaches no network. `vi.stubGlobal` keeps
 * that `fetch` as the original, so the `vi.unstubAllGlobals()` of every
 * `afterEach` puts it back, not the real one. A request that outlives its
 * test (the confirmation poll does not stop when a test times out) then
 * fails without a network call. If such a poll reaches the fake of a later
 * test, it asks for a hash that this network never received, which that
 * test records in `unexpected`.
 *
 * `.mock.ts` keeps this file out of `dist`.
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
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  type Operation,
  type OperationRecord,
  SorobanDataBuilder,
  scValToNative,
  type Transaction,
  TransactionBuilder,
  WebAuth,
  xdr,
} from '@stellar/stellar-sdk'
import { type Mock, vi } from 'vitest'
import { StellarProvider } from '../../StellarProvider.js'
import type {
  StellarSignedTransaction,
  StellarSignOptions,
  StellarWallet,
} from '../../types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const API_URL = 'https://api.lifi.test/v1'
/**
 * The only Stellar RPC URL, so `callStellarRpcsWithRetry` has exactly one
 * `Server`. The trailing slash is how `Server` writes its URL in requests.
 */
export const STELLAR_RPC_URL = 'https://stellar-rpc.test/'
/** `fromChain.metamask.blockExplorerUrls[0]`: the provider's `txLink` base. */
export const STELLAR_EXPLORER_URL = 'https://stellar-explorer.test/'
/** The explorer the fake `/status` answer links to (not the provider's). */
export const STATUS_EXPLORER_URL = 'https://stellar-status.test/'
export const ARB_EXPLORER_URL = 'https://arbiscan.test/'
/** The provider's default, and the wallet's network. */
export const NETWORK_PASSPHRASE: string = Networks.PUBLIC

/** What every account holds of every token: 1000 units (7 decimals). */
export const TOKEN_BALANCE = '10000000000'
/** Sequence number of every account before its first transaction. */
export const STARTING_SEQUENCE = 257698037760n
/** The latest ledger before the first landing; each landing adds one. */
export const START_LEDGER = 60000000
/** `step.action.fromAmount` of the XLM routes: 100 XLM. */
export const XLM_FROM_AMOUNT = '1000000000'
/** `step.action.fromAmount` of the USDC route: 10 USDC. */
export const USDC_FROM_AMOUNT = '100000000'
/** What `/status` says arrived on Stellar (same-chain swap). */
export const SWAP_RECEIVED_AMOUNT = '399000000'
/** What `/status` says arrived on Arbitrum (both bridges). */
export const BRIDGE_RECEIVED_AMOUNT = '9990000'
/** `step.action.toAddress` of the bridges: an EVM wallet. */
export const BRIDGE_TO_ADDRESS = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
/** The contract every quoted envelope invokes (made up: 32 bytes of 0x11). */
export const ROUTER_CONTRACT =
  'CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V'
/**
 * The CCTP leg's `approvalAddress`: the spender of the allowance (made up:
 * 32 bytes of 0x22).
 */
export const CCTP_SPENDER =
  'CARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEVQO'
/** What the fake wallet throws when the user rejects (made up). */
export const USER_REJECTION_MESSAGE = 'The user rejected this request.'

/** The native XLM Stellar Asset Contract on mainnet. */
export const XLM_TOKEN: Token = {
  address: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
  chainId: ChainId.XLM,
  symbol: 'XLM',
  decimals: 7,
  name: 'Stellar Lumens',
  priceUSD: '0.4',
  coinKey: 'XLM',
  logoURI: '',
} as Token

/** The Circle USDC Stellar Asset Contract on mainnet. */
export const USDC_TOKEN: Token = {
  address: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  chainId: ChainId.XLM,
  symbol: 'USDC',
  decimals: 7,
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

const STELLAR_CHAIN = {
  id: ChainId.XLM,
  key: 'xlm',
  chainType: ChainType.STL,
  name: 'Stellar',
  coin: 'XLM',
  mainnet: true,
  logoURI: '',
  nativeToken: XLM_TOKEN,
  metamask: {
    chainId: String(ChainId.XLM),
    chainName: 'Stellar',
    nativeCurrency: { name: 'XLM', symbol: 'XLM', decimals: 7 },
    rpcUrls: [STELLAR_RPC_URL],
    blockExplorerUrls: [STELLAR_EXPLORER_URL],
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

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/** The hash a node computes for a base64 envelope (hex, as the SDK writes it). */
export const hashOf = (envelope: string): string =>
  Buffer.from(
    (
      TransactionBuilder.fromXDR(envelope, NETWORK_PASSPHRASE) as Transaction
    ).hash()
  ).toString('hex')

export interface Invocation {
  /** The invoked contract (`C…`). */
  contract: string
  method: string
  /** The arguments, decoded with `scValToNative`. */
  args: unknown[]
}

interface ContractCall {
  /** The source account of the transaction (`G…`). */
  source: string
  call: xdr.InvokeContractArgs
  /** The auth entries of the operation. */
  auth: xdr.SorobanAuthorizationEntry[]
}

/** The contract call of a one-operation Soroban envelope, as XDR. */
const contractCallOf = (envelope: string): ContractCall => {
  const transaction = TransactionBuilder.fromXDR(
    envelope,
    NETWORK_PASSPHRASE
  ) as Transaction
  const [operation] = transaction.operations
  if (
    transaction.operations.length !== 1 ||
    operation.type !== 'invokeHostFunction'
  ) {
    throw new Error('Not a one-operation contract call')
  }
  const { func, auth = [] } = operation as Operation.InvokeHostFunction
  if (func.type !== 'hostFunctionTypeInvokeContract') {
    throw new Error('Not a contract call')
  }
  return { source: transaction.source, call: func.invokeContract, auth }
}

/** The contract call of a one-operation Soroban envelope. */
export const invocationOf = (envelope: string): Invocation => {
  const { call } = contractCallOf(envelope)
  return {
    contract: Address.fromScAddress(call.contractAddress).toString(),
    method: call.functionName.toString(),
    args: call.args.map((arg) => scValToNative(arg)),
  }
}

/** The sequence number of an envelope. */
export const sequenceOf = (envelope: string): bigint =>
  BigInt(
    (TransactionBuilder.fromXDR(envelope, NETWORK_PASSPHRASE) as Transaction)
      .sequence
  )

/** One auth entry of an operation, decoded from its XDR. */
export type AuthEntryFields =
  | { credentials: string; function: string }
  | {
      credentials: string
      contract: string
      method: string
      /** The arguments, decoded with `scValToNative`. */
      args: unknown[]
      /** The ScVal type of each argument, which `scValToNative` drops. */
      argTypes: string[]
      subInvocations: number
    }

/** One operation of an envelope, decoded from its XDR. */
export type OperationFields =
  | { type: string }
  | { type: string; function: string }
  | {
      type: string
      /** `null`: the operation runs as the transaction source. */
      source: string | null
      contract: string
      method: string
      /** The arguments, decoded with `scValToNative`. */
      args: unknown[]
      /** The ScVal type of each argument, which `scValToNative` drops. */
      argTypes: string[]
      auth: AuthEntryFields[]
    }

export interface SorobanDataFields {
  resourceFee: bigint
  instructions: number
  diskReadBytes: number
  writeBytes: number
  /** The footprint keys, as base64 XDR. */
  readOnly: string[]
  readWrite: string[]
  ext: string
}

/** A transaction envelope, decoded from its XDR. */
export type EnvelopeFields =
  | { envelope: string }
  | {
      source: string
      fee: string
      sequence: string
      preconditions: string
      timeBounds: { minTime: number; maxTime: number } | undefined
      memo: string
      operations: OperationFields[]
      sorobanData: SorobanDataFields | undefined
    }

/** The fields of one operation, decoded from the envelope XDR. */
export const operationFieldsOf = (
  operation: OperationRecord
): OperationFields => {
  if (operation.type !== 'invokeHostFunction') {
    return { type: operation.type }
  }
  const { func, auth = [], source } = operation
  if (func.type !== 'hostFunctionTypeInvokeContract') {
    return { type: operation.type, function: func.type }
  }
  const call = func.invokeContract
  return {
    type: operation.type,
    // An operation without its own source runs as the transaction source.
    source: source ?? null,
    contract: Address.fromScAddress(call.contractAddress).toString(),
    method: call.functionName.toString(),
    args: call.args.map((arg) => scValToNative(arg)),
    argTypes: call.args.map((arg) => arg.type),
    auth: auth.map(({ credentials, rootInvocation }): AuthEntryFields => {
      const authorized = rootInvocation.function
      if (authorized.type !== 'sorobanAuthorizedFunctionTypeContractFn') {
        return { credentials: credentials.type, function: authorized.type }
      }
      const authorizedCall = authorized.contractFn
      return {
        credentials: credentials.type,
        contract: Address.fromScAddress(
          authorizedCall.contractAddress
        ).toString(),
        method: authorizedCall.functionName.toString(),
        args: authorizedCall.args.map((arg) => scValToNative(arg)),
        argTypes: authorizedCall.args.map((arg) => arg.type),
        subInvocations: rootInvocation.subInvocations.length,
      }
    }),
  }
}

/**
 * Every field of an envelope that the SDK chooses, decoded from its XDR: the
 * transaction fields, the operations with their auth entries (each argument
 * as its value and its ScVal type), and the Soroban data. Not decoded: the
 * signatures (the wallet's).
 */
export const envelopeFieldsOf = (envelope: string): EnvelopeFields => {
  const transaction = TransactionBuilder.fromXDR(
    envelope,
    NETWORK_PASSPHRASE
  ) as Transaction
  const raw = transaction.toEnvelope()
  if (raw.type !== 'envelopeTypeTx') {
    return { envelope: raw.type }
  }
  const { cond, ext } = raw.v1.tx
  const sorobanData = ext.type === 'sorobanData' ? ext.sorobanData : undefined
  return {
    source: transaction.source,
    fee: transaction.fee,
    sequence: transaction.sequence,
    preconditions: cond.type,
    timeBounds: transaction.timeBounds && {
      minTime: Number(transaction.timeBounds.minTime),
      maxTime: Number(transaction.timeBounds.maxTime),
    },
    memo: transaction.memo.type,
    operations: transaction.operations.map(operationFieldsOf),
    sorobanData: sorobanData && {
      resourceFee: sorobanData.resourceFee,
      instructions: sorobanData.resources.instructions,
      diskReadBytes: sorobanData.resources.diskReadBytes,
      writeBytes: sorobanData.resources.writeBytes,
      readOnly: sorobanData.resources.footprint.readOnly.map((key) =>
        key.toXDR('base64')
      ),
      readWrite: sorobanData.resources.footprint.readWrite.map((key) =>
        key.toXDR('base64')
      ),
      ext: sorobanData.ext.type,
    },
  }
}

let quoteCounter = 0

/**
 * A route envelope as the backend builds it: one router call from `source`
 * at the next sequence number, Soroban data, timebounds `[0, now + 300 s]`.
 * The quote number is an argument, so two quotes never share a hash.
 */
const buildQuoteEnvelope = (
  source: string,
  sequence: bigint,
  fromAmount: string
): string => {
  quoteCounter += 1
  return new TransactionBuilder(new Account(source, sequence.toString()), {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(ROUTER_CONTRACT).call(
        'swap',
        Address.fromString(source).toScVal(),
        nativeToScVal(BigInt(fromAmount), { type: 'i128' }),
        nativeToScVal(quoteCounter, { type: 'u32' })
      )
    )
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(300)
    .build()
    .toXDR()
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

let routeCounter = 0

/**
 * - `swap`: XLM → USDC on Stellar (soroswap; the leg sets `skipApproval`).
 * - `bridge`: XLM on Stellar → USDC on Arbitrum (allbridge; `skipApproval`).
 * - `approvalBridge`: USDC on Stellar → USDC on Arbitrum (cctp). The leg
 *   pulls with `transfer_from`, so it names {@link CCTP_SPENDER} and needs
 *   an allowance.
 */
export type RouteKind = 'swap' | 'bridge' | 'approvalBridge'

/**
 * A one-step route as `/advanced/routes` returns it: no `transactionRequest`,
 * so the first run asks `/advanced/stepTransaction`. Route and step ids are
 * unique per call (execution state is keyed by route id).
 */
export const buildRoute = (kind: RouteKind, walletAddress: string): Route => {
  routeCounter += 1
  const bridge = kind !== 'swap'
  const fromToken = kind === 'approvalBridge' ? USDC_TOKEN : XLM_TOKEN
  const fromAmount =
    kind === 'approvalBridge' ? USDC_FROM_AMOUNT : XLM_FROM_AMOUNT
  const toToken = bridge ? ARB_USDC_TOKEN : USDC_TOKEN
  const toAddress = bridge ? BRIDGE_TO_ADDRESS : walletAddress
  const toAmount = bridge ? '9995000' : '400000000'
  const tool =
    kind === 'swap' ? 'soroswap' : kind === 'bridge' ? 'allbridge' : 'cctp'
  const action = {
    fromChainId: ChainId.XLM,
    toChainId: toToken.chainId,
    fromToken,
    toToken,
    fromAmount,
    slippage: 0.005,
    fromAddress: walletAddress,
    toAddress,
  }
  const estimate = {
    tool,
    fromAmount,
    fromAmountUSD: '40',
    toAmount,
    toAmountMin: toAmount,
    toAmountUSD: '40',
    approvalAddress: '',
    executionDuration: 30,
    feeCosts: [],
    gasCosts: [],
  }
  const leg =
    kind === 'approvalBridge'
      ? { approvalAddress: CCTP_SPENDER }
      : { approvalAddress: ROUTER_CONTRACT, skipApproval: true }
  const step = {
    id: `stellar-flow-step-${routeCounter}`,
    type: bridge ? 'cross' : 'swap',
    tool,
    toolDetails: { key: tool, name: tool, logoURI: '' },
    action,
    estimate,
    includedSteps: [
      {
        id: `stellar-flow-leg-${routeCounter}`,
        type: bridge ? 'cross' : 'swap',
        tool,
        toolDetails: { key: tool, name: tool, logoURI: '' },
        action,
        estimate: { ...estimate, ...leg },
      },
    ],
  } as unknown as LiFiStep
  return {
    id: `stellar-flow-route-${routeCounter}`,
    fromChainId: ChainId.XLM,
    toChainId: toToken.chainId,
    fromAmount,
    fromAmountUSD: '40',
    fromToken,
    toToken,
    toAmount,
    toAmountMin: toAmount,
    toAmountUSD: '40',
    fromAddress: walletAddress,
    toAddress,
    gasCostUSD: '0',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// Fake Stellar network and LI.FI API
// ---------------------------------------------------------------------------

export interface LandedTransaction {
  /** The signed envelope as it was sent (base64). */
  envelope: string
  status: 'SUCCESS' | 'FAILED'
  ledger: number
}

export interface FakeStellarNetwork {
  /** Every JSON-RPC method called, in order. */
  readonly rpcMethods: string[]
  /** Every envelope `sendTransaction` received, in order (base64). */
  readonly sent: string[]
  /** Calls and requests the fakes do not expect (must stay empty). */
  readonly unexpected: string[]
  /** Landed transactions by hash. */
  readonly landed: Map<string, LandedTransaction>
  /** Accepted transactions that RPC does not report yet: hash → envelope. */
  readonly hidden: Map<string, string>
  /** Bodies of the `/advanced/stepTransaction` requests, in order. */
  readonly stepTransactionRequests: LiFiStep[]
  /** `transactionRequest.data` of each `/advanced/stepTransaction` answer. */
  readonly quotes: string[]
  /** Query parameters of each `/status` request, in order. */
  readonly statusRequests: Record<string, string>[]
  /** The next accepted transaction lands with status FAILED. */
  failNextLanding: boolean
  /**
   * The next accepted transaction stays NOT_FOUND (RPC lags) until
   * {@link FakeStellarNetwork.releaseHidden}.
   */
  hideNextLanding: boolean
  /** Called with each envelope when `sendTransaction` arrives, before it lands. */
  onSend: ((envelope: string) => void) | undefined
  /** Gives `address` an account at {@link STARTING_SEQUENCE}. */
  registerAccount(address: string): void
  /** Lands every hidden transaction (with status SUCCESS). */
  releaseHidden(): void
  /**
   * The chain forgets every transaction: no landed or hidden hashes, no
   * allowances, every sequence number back at the start.
   */
  forgetChain(): void
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

const ZERO_HASH = Buffer.alloc(32)
const RESOURCE_FEE = '50000'
// A node's simulation answer is self-consistent: the Soroban data carries
// the resource fee that `minResourceFee` names. `prepareTransaction` takes
// the Soroban data as it is and adds its resource fee to the envelope fee.
const SOROBAN_DATA = new SorobanDataBuilder()
  .setResourceFee(RESOURCE_FEE)
  .build()
  .toXDR('base64')

const ledgerHeader = (sequence: number, closeTime: number): xdr.LedgerHeader =>
  new xdr.LedgerHeader({
    ledgerVersion: 23,
    previousLedgerHash: ZERO_HASH,
    scpValue: new xdr.StellarValue({
      txSetHash: ZERO_HASH,
      closeTime: xdr.Uint64.fromString(String(closeTime)),
      upgrades: [],
      ext: xdr.StellarValueExt.stellarValueBasic(),
    }),
    txSetResultHash: ZERO_HASH,
    bucketListHash: ZERO_HASH,
    ledgerSeq: sequence,
    totalCoins: xdr.Int64.fromString('0'),
    feePool: xdr.Int64.fromString('0'),
    inflationSeq: 0,
    idPool: xdr.Uint64.fromString('0'),
    baseFee: 100,
    baseReserve: 5000000,
    maxTxSetSize: 1000,
    skipList: [ZERO_HASH, ZERO_HASH, ZERO_HASH, ZERO_HASH],
    ext: xdr.LedgerHeaderExt.v0(),
  })

const transactionResult = (
  result: xdr.TransactionResultResult,
  feeCharged: string
): string =>
  new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString(feeCharged),
    result,
    ext: xdr.TransactionResultExt.v0(),
  }).toXDR('base64')

const TRANSACTION_META = xdr.TransactionMeta.v3(
  new xdr.TransactionMetaV3({
    ext: xdr.ExtensionPoint.v0(),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta: null,
  })
).toXDR('base64')

const accountKey = (address: string): string =>
  xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(address).xdrPublicKey(),
    })
  ).toXDR('base64')

const allowanceKey = (token: string, from: string, spender: string): string =>
  `${token}/${from}/${spender}`

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * The auth entry a node's recording-mode simulation returns for a contract
 * call that requires the auth of the transaction's source account (the SAC
 * `approve(from, …)` with `from` as the source): the transaction signature
 * authorizes the call, so the credentials are the source account's.
 */
const sourceAccountAuth = (
  call: xdr.InvokeContractArgs
): xdr.SorobanAuthorizationEntry =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          call
        ),
      subInvocations: [],
    }),
  })

/**
 * Whether a ledger accepts the auth of an `approve`: `from` is the source
 * account, and the operation carries exactly the simulated auth entry.
 */
const authorizesApprove = ({ source, call, auth }: ContractCall): boolean => {
  const [from] = call.args.map((arg) => scValToNative(arg)) as [string]
  return (
    from === source &&
    auth.length === 1 &&
    auth[0].toXDR('base64') === sourceAccountAuth(call).toXDR('base64')
  )
}

/** The `fetch` outside a test: it rejects and reaches no network. */
const closedFetch = (async (input: unknown) => {
  throw new Error(`The fake Stellar network is closed: ${urlOf(input)}`)
}) as typeof fetch

// Closed state (see the file comment): replace the real `fetch` before any
// spec stubs it, so `vi.unstubAllGlobals()` restores `closedFetch`.
globalThis.fetch = closedFetch

const createFakeStellarNetwork = (): FakeStellarNetwork => {
  const sequences = new Map<string, bigint>()
  const allowances = new Map<string, bigint>()
  let ledger = START_LEDGER

  const land = (hash: string, envelope: string): void => {
    // Decode first, so an envelope the fake cannot read does not land.
    const call = invocationOf(envelope)
    const approve = call.method === 'approve'
    // `approve` runs `from.require_auth()`: without the simulated auth
    // entry, a ledger fails the transaction.
    const unauthorized = approve && !authorizesApprove(contractCallOf(envelope))
    if (unauthorized) {
      network.unexpected.push(`approve without its auth entry: ${hash}`)
    }
    ledger += 1
    const status =
      network.failNextLanding || unauthorized ? 'FAILED' : 'SUCCESS'
    network.failNextLanding = false
    network.landed.set(hash, { envelope, status, ledger })
    if (status === 'SUCCESS' && approve) {
      const [from, spender, amount] = call.args as [string, string, bigint]
      allowances.set(allowanceKey(call.contract, from, spender), amount)
    }
  }

  const sendAnswer = (
    hash: string,
    status: 'PENDING' | 'DUPLICATE' | 'ERROR',
    error?: xdr.TransactionResultResult
  ) => ({
    status,
    hash,
    latestLedger: ledger,
    latestLedgerCloseTime: String(nowSeconds()),
    ...(error && { errorResultXdr: transactionResult(error, '0') }),
  })

  // What a node does with `sendTransaction`: decode, check the signature
  // and the sequence number, then queue it. A queued transaction lands at
  // once, so the first `getTransaction` poll already finds it.
  const sendTransaction = (envelope: string) => {
    network.sent.push(envelope)
    network.onSend?.(envelope)
    const transaction = TransactionBuilder.fromXDR(
      envelope,
      NETWORK_PASSPHRASE
    ) as Transaction
    const hash = hashOf(envelope)
    if (network.hidden.has(hash)) {
      return sendAnswer(hash, 'DUPLICATE')
    }
    if (!WebAuth.verifyTxSignedBy(transaction, transaction.source)) {
      network.unexpected.push(`invalid signature for ${hash}`)
      return sendAnswer(hash, 'ERROR', xdr.TransactionResultResult.txBadAuth())
    }
    const sequence = sequences.get(transaction.source)
    if (sequence === undefined) {
      network.unexpected.push(`unknown account ${transaction.source}`)
      return sendAnswer(
        hash,
        'ERROR',
        xdr.TransactionResultResult.txNoAccount()
      )
    }
    // An applied transaction has spent its sequence number, so sending it
    // again is refused the same way as any other stale envelope.
    if (BigInt(transaction.sequence) !== sequence + 1n) {
      return sendAnswer(hash, 'ERROR', xdr.TransactionResultResult.txBadSeq())
    }
    sequences.set(transaction.source, BigInt(transaction.sequence))
    if (network.hideNextLanding) {
      network.hideNextLanding = false
      network.hidden.set(hash, envelope)
    } else {
      land(hash, envelope)
    }
    return sendAnswer(hash, 'PENDING')
  }

  const getTransaction = (hash: string) => {
    const window = {
      latestLedger: ledger,
      latestLedgerCloseTime: String(nowSeconds()),
      oldestLedger: START_LEDGER - 120960,
      oldestLedgerCloseTime: String(nowSeconds() - 7 * 24 * 3600),
    }
    const landed = network.landed.get(hash)
    if (!landed) {
      // A node answers NOT_FOUND for any hash. A hash that this node never
      // received is a poll for the wrong hash, or a poll that outlived an
      // earlier test. `forgetChain()` keeps `sent`, so a probe for a
      // forgotten transaction stays legal.
      if (!network.sent.some((envelope) => hashOf(envelope) === hash)) {
        network.unexpected.push(`getTransaction for unknown hash ${hash}`)
      }
      return { status: 'NOT_FOUND', txHash: hash, ...window }
    }
    const transaction = TransactionBuilder.fromXDR(
      landed.envelope,
      NETWORK_PASSPHRASE
    ) as Transaction
    return {
      status: landed.status,
      txHash: hash,
      ...window,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: transaction.toEnvelope().toXDR('base64'),
      resultXdr: transactionResult(
        landed.status === 'SUCCESS'
          ? xdr.TransactionResultResult.txSuccess([])
          : xdr.TransactionResultResult.txFailed([]),
        transaction.fee
      ),
      resultMetaXdr: TRANSACTION_META,
      ledger: landed.ledger,
      createdAt: String(nowSeconds()),
    }
  }

  // Read-only simulation of the SAC calls the provider makes, and the
  // simulation `prepareTransaction` runs for an approval.
  const simulateTransaction = (envelope: string) => {
    const call = invocationOf(envelope)
    const answer = (
      retval: xdr.ScVal,
      auth: xdr.SorobanAuthorizationEntry[] = []
    ) => ({
      latestLedger: ledger,
      minResourceFee: RESOURCE_FEE,
      transactionData: SOROBAN_DATA,
      results: [
        {
          auth: auth.map((entry) => entry.toXDR('base64')),
          xdr: retval.toXDR('base64'),
        },
      ],
      events: [],
    })
    switch (call.method) {
      case 'balance':
        return answer(nativeToScVal(BigInt(TOKEN_BALANCE), { type: 'i128' }))
      case 'allowance': {
        const [from, spender] = call.args as [string, string]
        const allowance =
          allowances.get(allowanceKey(call.contract, from, spender)) ?? 0n
        return answer(nativeToScVal(allowance, { type: 'i128' }))
      }
      case 'approve':
        // Recording mode: `prepareTransaction` copies this entry into the
        // operation, so the approval the wallet signs carries it.
        return answer(xdr.ScVal.scvVoid(), [
          sourceAccountAuth(contractCallOf(envelope).call),
        ])
      default:
        network.unexpected.push(`simulate ${call.contract}.${call.method}`)
        return { latestLedger: ledger, error: `unknown ${call.method}` }
    }
  }

  const rpc = (method: string, params: Record<string, unknown> | null) => {
    switch (method) {
      case 'simulateTransaction':
        return simulateTransaction(String(params?.transaction))
      case 'sendTransaction':
        return sendTransaction(String(params?.transaction))
      case 'getTransaction':
        return getTransaction(String(params?.hash))
      case 'getLedgerEntries': {
        const keys = (params?.keys ?? []) as string[]
        const entries = keys.flatMap((key) => {
          const address = [...sequences.keys()].find(
            (account) => accountKey(account) === key
          )
          if (!address) {
            network.unexpected.push(`getLedgerEntries ${key}`)
            return []
          }
          const entry = new xdr.AccountEntry({
            accountId: Keypair.fromPublicKey(address).xdrPublicKey(),
            balance: xdr.Int64.fromString(TOKEN_BALANCE),
            seqNum: xdr.Int64.fromString(String(sequences.get(address))),
            numSubEntries: 0,
            inflationDest: null,
            flags: 0,
            homeDomain: '',
            thresholds: Buffer.from([1, 0, 0, 0]),
            signers: [],
            ext: xdr.AccountEntryExt.v0(),
          })
          return [
            {
              key,
              xdr: xdr.LedgerEntryData.account(entry).toXDR('base64'),
              lastModifiedLedgerSeq: ledger,
            },
          ]
        })
        return { latestLedger: ledger, entries }
      }
      case 'getLatestLedger': {
        const closeTime = nowSeconds()
        const header = ledgerHeader(ledger, closeTime)
        const meta = xdr.LedgerCloseMeta.v0(
          new xdr.LedgerCloseMetaV0({
            ledgerHeader: new xdr.LedgerHeaderHistoryEntry({
              hash: ZERO_HASH,
              header,
              ext: xdr.LedgerHeaderHistoryEntryExt.v0(),
            }),
            txSet: new xdr.TransactionSet({
              previousLedgerHash: ZERO_HASH,
              txs: [],
            }),
            txProcessing: [],
            upgradesProcessing: [],
            scpInfo: [],
          })
        )
        return {
          id: ZERO_HASH.toString('hex'),
          sequence: ledger,
          protocolVersion: 23,
          closeTime: String(closeTime),
          headerXdr: header.toXDR('base64'),
          metadataXdr: meta.toXDR('base64'),
        }
      }
      case 'getFeeStats': {
        const distribution = (p70: string) => ({
          max: '1000',
          min: '100',
          mode: '100',
          p10: '100',
          p20: '100',
          p30: '100',
          p40: '100',
          p50: '100',
          p60: '100',
          p70,
          p80: '200',
          p90: '300',
          p95: '400',
          p99: '900',
          transactionCount: '25',
          ledgerCount: 50,
        })
        return {
          sorobanInclusionFee: distribution('150'),
          inclusionFee: distribution('100'),
          latestLedger: ledger,
        }
      }
      default:
        network.unexpected.push(`rpc ${method}`)
        return undefined
    }
  }

  const network: FakeStellarNetwork = {
    rpcMethods: [],
    sent: [],
    unexpected: [],
    landed: new Map(),
    hidden: new Map(),
    stepTransactionRequests: [],
    quotes: [],
    statusRequests: [],
    failNextLanding: false,
    hideNextLanding: false,
    onSend: undefined,
    registerAccount(address) {
      if (!sequences.has(address)) {
        sequences.set(address, STARTING_SEQUENCE)
      }
    },
    releaseHidden() {
      for (const [hash, envelope] of network.hidden) {
        network.hidden.delete(hash)
        land(hash, envelope)
      }
    },
    forgetChain() {
      network.landed.clear()
      network.hidden.clear()
      allowances.clear()
      for (const address of sequences.keys()) {
        sequences.set(address, STARTING_SEQUENCE)
      }
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      // For the error record: the URL, and the JSON-RPC method once it is
      // known, else the URL path.
      let url = ''
      let target = ''
      let rpcId: number | null = null
      try {
        url = urlOf(input)
        target = url.replace(/^[a-z]+:\/\/[^/]*/i, '').split('?')[0]
        const body =
          typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.text()
              : undefined
        if (url === STELLAR_RPC_URL) {
          const request = JSON.parse(String(body)) as {
            id: number
            method: string
            params: Record<string, unknown> | null
          }
          target = request.method
          rpcId = request.id
          network.rpcMethods.push(request.method)
          const result = rpc(request.method, request.params)
          return result === undefined
            ? json({
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32601, message: 'method not found' },
              })
            : json({ jsonrpc: '2.0', id: request.id, result })
        }
        if (url === `${API_URL}/advanced/stepTransaction`) {
          const requested = JSON.parse(String(body)) as LiFiStep
          network.stepTransactionRequests.push(requested)
          const source = requested.action.fromAddress as string
          const sequence = sequences.get(source)
          if (sequence === undefined) {
            network.unexpected.push(`quote for unknown account ${source}`)
            return json({ message: 'Unknown account' }, 400)
          }
          const data = buildQuoteEnvelope(
            source,
            sequence,
            requested.action.fromAmount
          )
          network.quotes.push(data)
          return json({ ...requested, transactionRequest: { data } })
        }
        if (url.startsWith(`${API_URL}/status?`)) {
          const query = Object.fromEntries(new URL(url).searchParams)
          network.statusRequests.push(query)
          const txHash = query.txHash ?? ''
          if (network.landed.get(txHash)?.status !== 'SUCCESS') {
            // Main polls `/status` forever while the answer is not DONE, so
            // an unknown hash answers DONE without `receiving`: main then
            // fails at once instead of hanging.
            network.unexpected.push(`/status for unknown hash ${txHash}`)
            return json({ status: 'DONE', substatus: 'COMPLETED' })
          }
          return json(statusAnswer(txHash, query))
        }
        network.unexpected.push(`fetch ${url}`)
        return json({ message: `Unexpected request ${url}` }, 404)
      } catch (error) {
        // Main swallows a failed RPC request in places (the confirmation
        // poll polls again), so a throw in the fakes is recorded.
        const message = error instanceof Error ? error.message : String(error)
        network.unexpected.push(
          `harness error: ${target} on ${url}: ${message}`
        )
        if (url !== STELLAR_RPC_URL) {
          // The LI.FI API paths keep their visible failure: the request
          // rejects.
          throw error
        }
        return json({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: -32603, message: `harness error: ${message}` },
        })
      }
    }) as typeof fetch,
  }
  return network
}

/** The destination hash the fake `/status` reports for a bridge. */
export const destinationTxHashOf = (hash: string): string => `0x${hash}`

const statusAnswer = (txHash: string, query: Record<string, string>) => {
  const toChainId = Number(query.toChain)
  const bridge = toChainId !== ChainId.XLM
  const receivingHash = bridge ? destinationTxHashOf(txHash) : txHash
  return {
    status: 'DONE',
    substatus: 'COMPLETED',
    tool: query.bridge,
    sending: {
      txHash,
      txLink: `${STATUS_EXPLORER_URL}tx/${txHash}`,
      chainId: ChainId.XLM,
      amount: query.bridge === 'cctp' ? USDC_FROM_AMOUNT : XLM_FROM_AMOUNT,
      token: query.bridge === 'cctp' ? USDC_TOKEN : XLM_TOKEN,
      gasPrice: '100',
      gasUsed: '1',
      gasToken: XLM_TOKEN,
      gasAmount: '1050000',
      gasAmountUSD: '0.04',
      timestamp: 1,
    },
    receiving: {
      txHash: receivingHash,
      txLink: bridge
        ? `${ARB_EXPLORER_URL}tx/${receivingHash}`
        : `${STATUS_EXPLORER_URL}tx/${receivingHash}`,
      chainId: toChainId,
      amount: bridge ? BRIDGE_RECEIVED_AMOUNT : SWAP_RECEIVED_AMOUNT,
      token: bridge ? ARB_USDC_TOKEN : USDC_TOKEN,
      timestamp: 2,
    },
  }
}

/**
 * A new fake network for one spec; `globalThis.fetch` is its RPC and its
 * LI.FI API. Undo with `vi.unstubAllGlobals()` in `afterEach`: it puts
 * back the closed `fetch` (see the file comment), not the real one.
 */
export const installFakeStellarNetwork = (): FakeStellarNetwork => {
  const network = createFakeStellarNetwork()
  vi.stubGlobal('fetch', network.fetch)
  return network
}

// ---------------------------------------------------------------------------
// One "page": a wallet, a provider and an SDK client
// ---------------------------------------------------------------------------

export type SignTransaction = (
  xdr: string,
  opts?: StellarSignOptions
) => Promise<StellarSignedTransaction>

export interface Page {
  client: SDKClient
  keypair: Keypair
  walletAddress: string
  /** The wallet's `signTransaction`, spied (it still signs). */
  signTransaction: Mock<SignTransaction>
}

/**
 * A new page. Without `keypair` it has a new wallet key, so every hash is
 * unique; a reload passes the key of the page it replaces.
 */
export const openPage = (
  network: FakeStellarNetwork,
  keypair: Keypair = Keypair.random()
): Page => {
  network.registerAccount(keypair.publicKey())
  const signTransaction = vi.fn<SignTransaction>(async (envelope, opts) => {
    const transaction = TransactionBuilder.fromXDR(
      envelope,
      opts?.networkPassphrase ?? NETWORK_PASSPHRASE
    ) as Transaction
    transaction.sign(keypair)
    return {
      signedTxXdr: transaction.toXDR(),
      signerAddress: keypair.publicKey(),
    }
  })
  const wallet: StellarWallet = {
    address: keypair.publicKey(),
    networkPassphrase: NETWORK_PASSPHRASE,
    signTransaction,
  }
  const provider = StellarProvider({ getWallet: async () => wallet })
  const client = createClient({
    integrator: 'stellar-flow-specs',
    apiUrl: API_URL,
    preloadChains: false,
    disableVersionCheck: true,
    providers: [provider],
    rpcUrls: { [ChainId.XLM]: [STELLAR_RPC_URL] },
  })
  client.setChains([STELLAR_CHAIN, ARB_CHAIN])
  return {
    client,
    keypair,
    walletAddress: keypair.publicKey(),
    signTransaction,
  }
}

/** The user rejects the next signature request of this page's wallet. */
export const rejectNextSignature = (page: Page): void => {
  page.signTransaction.mockRejectedValueOnce(new Error(USER_REJECTION_MESSAGE))
}

/** The envelope passed to each `signTransaction` call, in order. */
export const envelopesToSign = (page: Page): string[] =>
  page.signTransaction.mock.calls.map(([envelope]) => envelope)

/** The signed envelope each settled `signTransaction` call returned. */
export const signedEnvelopes = async (page: Page): Promise<string[]> => {
  const settled = await Promise.allSettled(
    page.signTransaction.mock.results.map((result) => result.value)
  )
  return settled.flatMap((result) =>
    result.status === 'fulfilled'
      ? [(result.value as StellarSignedTransaction).signedTxXdr]
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

/** The action of `type` in the step of a one-step route. */
export const actionOf = (
  route: RouteExtended,
  type: ExecutionActionType
): ExecutionAction | undefined =>
  stepOf(route).execution?.actions.find((action) => action.type === type)
