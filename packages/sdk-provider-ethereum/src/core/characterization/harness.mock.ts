/**
 * Shared harness for the EVM characterization suite.
 *
 * These specs pin *observed* behaviour of `main`, so the harness drives the
 * real consumer entry point — `executeRoute` → `EthereumProvider.getStepExecutor`
 * → `EthereumStepExecutor.executeStep` → the real `TaskPipeline` — and records
 * what came out. Nothing in the pipeline is re-implemented here.
 *
 * ## Where the seams are
 *
 * Almost every wallet/RPC call in this package goes through viem's
 * `getAction(client, fn, name)`, which prefers a method of that name *on the
 * client*. So the wallet client and the public client are plain objects
 * carrying `signTypedData`, `sendTransaction`, `sendCalls`, `readContract`,
 * `getCode`, … — the same override seam a real wallet client uses. No
 * `vi.mock('viem/actions')` is needed, and the interception point is the one
 * production code actually reads.
 *
 * The rest cannot be reached that way and must be mocked per spec at the module
 * boundary (the house style of `EthereumCheckPermitsTask.unit.spec.ts` and
 * `resolvePermit2Support.unit.spec.ts`). Every spec needs this preamble:
 *
 * ```ts
 * vi.mock('@lifi/sdk', async (importOriginal) => {
 *   const actual = await importOriginal<typeof import('@lifi/sdk')>()
 *   return {
 *     ...actual,
 *     getStepTransaction: vi.fn(),
 *     getRelayerQuote: vi.fn(),
 *     relayTransaction: vi.fn(),
 *     WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
 *       shouldRun = async (): Promise<boolean> => true
 *       run = async (): Promise<{ status: 'COMPLETED' }> => ({
 *         status: 'COMPLETED',
 *       })
 *     },
 *   }
 * })
 * vi.mock('../../client/publicClient.js')
 * vi.mock('../../actions/waitForTransactionReceipt.js')
 * vi.mock('../../actions/waitForRelayedTransactionReceipt.js')
 * ```
 *
 * `WaitForTransactionStatusTask` is the only *pipeline* behaviour stubbed out:
 * it polls `getStatus` over HTTP every 5s and never terminates under test. It
 * is the terminal destination-status watcher and runs after everything these
 * specs assert on. `EthereumWaitForTransactionTask` and its three variants stay
 * real; only the receipt fetchers underneath them are mocked.
 *
 * ## The timeline
 *
 * Per-channel spies cannot express "X happened before Y" across channels, which
 * is most of what these specs assert. So every observable effect — each
 * `StatusManager` mutation, each route-hook fire, each signature, transaction,
 * batch, relay and contract read — lands on one append-only {@link Scenario.timeline}
 * with a monotonic `seq`. Ordering is a slice; absence is an empty filter.
 *
 * ## One scenario at a time
 *
 * {@link createScenario} installs its implementations on the *module-level*
 * `@lifi/sdk` mocks — `getStepTransaction`, `getRelayerQuote`,
 * `relayTransaction`, `getPublicClient` and both receipt fetchers. The last
 * `createScenario` wins, and `vi.clearAllMocks()` clears calls but not
 * implementations. So a spec that needs two runs must construct, run, then
 * construct the next — never construct both up front, or the second scenario
 * silently drives the first one's re-quote, relay and contract reads. The
 * `StatusManager` wrapper and the wallet client are per-provider and are not
 * affected, which is what makes the mistake invisible.
 *
 * ## Permit2 vs. Permit2Proxy
 *
 * {@link CANONICAL_PERMIT2} is Uniswap's Permit2 (`chain.permit2`).
 * {@link LIFI_PERMIT2_PROXY} is LI.FI's own proxy (`chain.permit2Proxy`).
 * They are deliberately unrelated addresses and no spec may inline either.
 *
 * ## Why `.mock.ts`
 *
 * The `.mock.ts` suffix is load-bearing, not decorative. `tsdown.config.ts`,
 * `package.json#files` and `tsconfig.json#exclude` each exclude a `.mock.ts`
 * glob, and none of them excludes a bare `harness.ts`. Under any other name
 * this module would be compiled into `dist` and published to every consumer of
 * `@lifi/sdk-provider-ethereum`. Do not rename it back.
 */
import {
  ChainType,
  createClient,
  type ExecutionOptions,
  type ExtendedChain,
  executeRoute,
  type GasCost,
  getRelayerQuote,
  getStepTransaction,
  type LiFiStep,
  type LiFiStepExtended,
  type Route,
  type RouteExtended,
  relayTransaction,
  resumeRoute,
  type SDKClient,
  type SDKProvider,
  type SignedTypedData,
  type StepExecutorOptions,
  type Token,
  type TokenAmount,
  type TypedData,
  type TypedDataDomain,
  type TypedDataPrimaryType,
} from '@lifi/sdk'
import type { Address, Client, Hash, Hex } from 'viem'
import { decodeFunctionData } from 'viem'
import type { Mock } from 'vitest'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import { getPublicClient } from '../../client/publicClient.js'
import { EthereumProvider } from '../../EthereumProvider.js'
import { approveAbi, permit2ProxyAbi } from '../../utils/abi.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

export const CHAIN_ID: number = 137

/** Uniswap's canonical Permit2 — `chain.permit2`. */
export const CANONICAL_PERMIT2: Address =
  '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/** LI.FI's own Permit2Proxy — `chain.permit2Proxy`. Not Permit2. */
export const LIFI_PERMIT2_PROXY: Address =
  '0xA3C7a31a2A97b847D967e0B755921D084C46a742'

/** `step.estimate.approvalAddress` — the LI.FI diamond. */
export const APPROVAL_ADDRESS: Address =
  '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

/** A third-party router: neither Permit2 nor the proxy nor the diamond. */
export const THIRD_PARTY_ROUTER: Address =
  '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'

/** A protocol contract used as an EIP-2612 spender in the order flow. */
export const PROTOCOL_CONTRACT: Address =
  '0x4E4d8Cb3DB5D5Eb0AB0e4d0f6e9f8c62B5c2A4d1'

export const FROM_ADDRESS: Address =
  '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

export const FROM_TOKEN_ADDRESS: Address =
  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'

export const TO_TOKEN_ADDRESS: Address =
  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'

export const FROM_AMOUNT: string = '1500000'

/**
 * Signature the wallet returns by default. The last byte MUST stay a valid
 * recovery id: `encodeNativePermitData` runs it through viem's `parseSignature`,
 * which throws on anything but `00`/`01`/`1b`/`1c`.
 */
export const WALLET_SIGNATURE: Hex = `0x${'11'.repeat(64)}1b`

/** Agent-wallet signatures are produced by a real local account, not this. */
export const RELAY_TASK_ID: Hex = `0x${'7a'.repeat(32)}`

export const PERMIT2_PROXY_NONCE: bigint = 42n

export const TOKEN_EIP712_NAME: string = '(PoS) USD Coin'

const ERC1271_ACCEPTED: Hex = `0x${'00'.repeat(31)}01`

const HUGE_BALANCE = 10n ** 30n

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineEventDetail =
  /** A `StatusManager.createAction` / `updateAction` mutation. */
  | {
      kind: 'action'
      actionType: string
      status: string
      txHash?: string
      taskId?: string
    }
  /** A `StatusManager.updateExecution` mutation. */
  | { kind: 'execution'; status?: string }
  /** One `updateRouteHook` fire, i.e. one notification a consumer sees. */
  | { kind: 'routeUpdate' }
  | {
      kind: 'signTypedData'
      primaryType: string
      domain: TypedDataDomain
      message: Record<string, unknown>
    }
  | { kind: 'sendTransaction'; to?: string; data?: string; value?: bigint }
  | { kind: 'sendCalls'; calls: { to?: string; data?: string }[] }
  | { kind: 'relayTransaction'; typedData: SignedTypedData[] }
  | { kind: 'getStepTransaction' }
  | { kind: 'getRelayerQuote' }
  | {
      kind: 'readContract'
      address: string
      functionName: string
      args: readonly unknown[]
    }
  | { kind: 'getCode'; address: string }
  | { kind: 'getCapabilities' }
  | { kind: 'estimateGas'; to?: string }

/**
 * What every timeline entry carries on top of its own detail.
 *
 * `actions` is the array a *consumer* reads — `step.execution.actions`, as
 * `TYPE:STATUS`, at the moment this event landed. It is not the same thing as
 * the order of `StatusManager` calls the `action` events record:
 * `StatusManager.updateAction` re-sorts the array DONE-first on every call and
 * `initializeAction` reuses an existing action of the same type instead of
 * appending a second one, so the call order and the array order can differ.
 * The widget reads `actions.at(-1)` for its headline text and its icon, which
 * makes the array order user-visible even when execution is byte-identical.
 *
 * For an `action` event the snapshot is taken *after* the real `StatusManager`
 * method returned, so it shows that call's effect. For every other kind it is
 * the state at that instant, i.e. the effect of the most recent mutation.
 */
export type TimelineEventCommon = { seq: number; actions: string[] }

export type TimelineEvent = TimelineEventDetail & TimelineEventCommon

export type TimelineKind = TimelineEventDetail['kind']

export type TimelineEventOf<K extends TimelineKind> = Extract<
  TimelineEventDetail,
  { kind: K }
> &
  TimelineEventCommon

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildToken = (
  address: Address,
  symbol: string,
  decimals: number
): Token =>
  ({
    address,
    chainId: CHAIN_ID,
    symbol,
    decimals,
    name: symbol,
    priceUSD: '1',
    coinKey: symbol,
    logoURI: '',
  }) as unknown as Token

export const FROM_TOKEN: Token = buildToken(FROM_TOKEN_ADDRESS, 'USDC', 6)
export const TO_TOKEN: Token = buildToken(TO_TOKEN_ADDRESS, 'USDT', 6)
export const NATIVE_TOKEN: Token = buildToken(
  '0x0000000000000000000000000000000000000000',
  'POL',
  18
)

export interface ChainFixtureOptions {
  permit2?: Address
  permit2Proxy?: Address
  id?: number
}

/**
 * Source chain. `permit2` and `permit2Proxy` are distinct by construction; a
 * chain without one of them is expressed by passing `undefined`.
 */
export const buildChain = (
  options: ChainFixtureOptions = {}
): ExtendedChain => {
  const { permit2 = CANONICAL_PERMIT2, permit2Proxy = LIFI_PERMIT2_PROXY } =
    options
  return {
    id: options.id ?? CHAIN_ID,
    key: 'pol',
    chainType: ChainType.EVM,
    name: 'Polygon',
    coin: 'POL',
    mainnet: true,
    logoURI: '',
    diamondAddress: APPROVAL_ADDRESS,
    permit2,
    permit2Proxy,
    nativeToken: NATIVE_TOKEN,
    metamask: {
      chainId: '0x89',
      chainName: 'Polygon',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon.example/rpc'],
      blockExplorerUrls: ['https://polygonscan.example/'],
    },
  } as unknown as ExtendedChain
}

export interface StepFixtureOptions {
  typedData?: TypedData[]
  /**
   * Destination chain id. Different from {@link CHAIN_ID} makes the step a
   * bridge, so `isBridgeExecution` is true and every `findAction` in the
   * pipeline looks for `CROSS_CHAIN` instead of `SWAP`.
   */
  toChainId?: number
  transactionRequest?: Record<string, unknown>
  tool?: string
  type?: string
  approvalAddress?: string
  approvalReset?: boolean
  skipApproval?: boolean
  skipPermit?: boolean
  gasCosts?: GasCost[]
  fromAmount?: string
}

/**
 * A step with **no** `execution` object: `StatusManager.initializeExecution`
 * only notifies the route when it has to create one, so shipping a pre-built
 * execution would silently shift every pinned notification count.
 */
export const buildStep = (
  options: StepFixtureOptions = {}
): LiFiStepExtended => {
  const fromAmount = options.fromAmount ?? FROM_AMOUNT
  const step = {
    id: 'characterization-step',
    type: options.type ?? 'lifi',
    tool: options.tool ?? '1inch',
    toolDetails: { key: 'tool', name: 'Tool', logoURI: '' },
    action: {
      fromChainId: CHAIN_ID,
      toChainId: options.toChainId ?? CHAIN_ID,
      fromToken: FROM_TOKEN,
      toToken:
        options.toChainId === undefined
          ? TO_TOKEN
          : { ...TO_TOKEN, chainId: options.toChainId },
      fromAmount,
      slippage: 0.03,
      fromAddress: FROM_ADDRESS,
      toAddress: FROM_ADDRESS,
    },
    estimate: {
      fromAmount,
      fromAmountUSD: '1.5',
      toAmount: '1490000',
      toAmountUSD: '1.49',
      toAmountMin: '1445300',
      approvalAddress:
        options.approvalAddress === undefined
          ? APPROVAL_ADDRESS
          : options.approvalAddress,
      approvalReset: options.approvalReset,
      skipApproval: options.skipApproval,
      skipPermit: options.skipPermit,
      executionDuration: 30,
      feeCosts: [],
      gasCosts: options.gasCosts ?? [],
      tool: options.tool ?? '1inch',
    },
    // Must exist and must contain no `custom` step, or `isContractCallStep`
    // reroutes the re-quote to `getContractCallsQuote`.
    includedSteps: [],
    execution: undefined,
  } as unknown as LiFiStepExtended

  if (options.typedData) {
    step.typedData = options.typedData
  }
  if (options.transactionRequest) {
    step.transactionRequest =
      options.transactionRequest as LiFiStepExtended['transactionRequest']
  }
  return step
}

/** A plain `transactionRequest` pointing at the diamond. */
export const buildTransactionRequest = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  chainId: CHAIN_ID,
  to: APPROVAL_ADDRESS,
  from: FROM_ADDRESS,
  data: `0x${'de'.repeat(32)}`,
  value: '0x0',
  gasLimit: '500000',
  ...overrides,
})

export interface TypedDataFixtureOptions {
  primaryType: string
  domain?: TypedDataDomain
  message?: Record<string, unknown>
}

export const buildTypedData = (options: TypedDataFixtureOptions): TypedData =>
  ({
    primaryType: options.primaryType as TypedDataPrimaryType,
    domain: options.domain ?? { chainId: CHAIN_ID },
    types: {},
    message: options.message ?? {},
  }) as TypedData

/** Seconds-since-epoch deadline far enough out to pass `isNativePermitValid`. */
export const futureDeadline = (): string =>
  String(Math.floor(Date.now() / 1000) + 30 * 60)

/**
 * EIP-2612 `Permit`. `spender` is the caller's choice on purpose — the whole
 * point of several scenarios is *which* contract the permit authorises.
 */
export const buildPermitTypedData = (spender: Address): TypedData =>
  buildTypedData({
    primaryType: 'Permit',
    domain: {
      name: TOKEN_EIP712_NAME,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: FROM_TOKEN_ADDRESS,
    },
    message: {
      owner: FROM_ADDRESS,
      spender,
      value: FROM_AMOUNT,
      nonce: '0',
      deadline: futureDeadline(),
    },
  })

/**
 * Permit2 `PermitWitnessTransferFrom`: the witness is *spent by the proxy* but
 * *verified by canonical Permit2*, so `message.spender` and
 * `domain.verifyingContract` are deliberately different contracts.
 */
export const buildPermitWitnessTypedData = (): TypedData =>
  buildTypedData({
    primaryType: 'PermitWitnessTransferFrom',
    domain: {
      name: 'Permit2',
      chainId: CHAIN_ID,
      verifyingContract: CANONICAL_PERMIT2,
    },
    message: {
      permitted: { token: FROM_TOKEN_ADDRESS, amount: FROM_AMOUNT },
      spender: LIFI_PERMIT2_PROXY,
      nonce: '1',
      deadline: futureDeadline(),
    },
  })

// ---------------------------------------------------------------------------
// Calldata decoding — assertions read the decoded form, never a hex blob
// ---------------------------------------------------------------------------

export interface DecodedApproval {
  spender: Address
  amount: bigint
}

export const decodeApproval = (data: Hex): DecodedApproval => {
  const { functionName, args } = decodeFunctionData({ abi: approveAbi, data })
  if (functionName !== 'approve') {
    throw new Error(`Expected an approve call, got ${functionName}.`)
  }
  const [spender, amount] = args as [Address, bigint]
  return { spender, amount }
}

export interface DecodedProxyCall {
  functionName: string
  args: readonly unknown[]
}

export const decodePermit2ProxyCall = (data: Hex): DecodedProxyCall => {
  const { functionName, args } = decodeFunctionData({
    abi: permit2ProxyAbi,
    data,
  })
  return { functionName, args: (args ?? []) as readonly unknown[] }
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export interface SignTypedDataRequest {
  primaryType: string
  domain: TypedDataDomain
  message: Record<string, unknown>
}

export interface ReadContractRequest {
  address: Address
  functionName: string
  args?: readonly unknown[]
}

export interface ScenarioOptions {
  /** The step to execute. */
  step: LiFiStepExtended
  /** Source chain; defaults to {@link buildChain}. */
  chain?: ExtendedChain
  /** ERC-20 allowance the source token reports for whichever spender is asked. */
  allowance?: bigint
  /** `eth_getCode` for the signer: `'0x'` is an EOA. */
  accountCode?: Hex
  /** `wallet_getCapabilities` answer for the source chain (EIP-5792). */
  capabilities?: Record<string, unknown>
  /** Whether the source token answers the EIP-2612 / EIP-5267 reads. */
  nativePermitSupported?: boolean
  /** ERC-1271 probe result; `'revert'` makes `isValidSignature` throw. */
  erc1271Response?: Hex | 'revert'
  /** Forwarded to `EthereumProvider`, i.e. the execution context flag. */
  disableMessageSigning?: boolean
  /** Wallet signing behaviour. Throw to model a user rejection. */
  onSignTypedData?: (
    request: SignTypedDataRequest,
    callIndex: number
  ) => Promise<Hex>
  /**
   * What `getStepTransaction` answers with. The default mirrors the real
   * endpoint: it answers with a transaction and *drops* the typed data it was
   * posted, so a scenario that wants typed data back has to say so.
   */
  onStepTransaction?: (step: LiFiStep) => LiFiStep
  /** What `getRelayerQuote` answers with. Defaults to the step unchanged. */
  onRelayerQuote?: (step: LiFiStep) => LiFiStep
  /**
   * Destination chain, for a cross-chain step. Supplying it registers a second
   * chain with the client; `isBridgeExecution` is then true because
   * `BaseStepExecutor.createBaseContext` compares `fromChain.id` to
   * `toChain.id`.
   */
  toChain?: ExtendedChain
  /**
   * Wallet behaviour for `wallet_sendCalls`. Throw
   * `AtomicReadyWalletRejectedUpgradeError` to model a wallet declining the
   * EIP-7702 upgrade, which is what drives the `atomicityNotReady` retry.
   */
  onSendCalls?: (request: {
    calls: { to?: Address; data?: Hex }[]
  }) => Promise<{ id: Hex }>
  /**
   * `executeInBackground` as a consumer passes it to `executeRoute`. It is the
   * only public route to `allowUserInteraction: false`:
   * `updateRouteExecution` turns it into `setInteraction({ allowInteraction })`
   * on every executor, and each task then returns `{ status: 'PAUSED' }` at its
   * own interaction gate.
   */
  executeInBackground?: boolean
}

export interface Scenario {
  /** Every observable effect, in the order it happened. */
  readonly timeline: TimelineEvent[]
  /** Executes the route. Rejects exactly as the SDK would. */
  run(): Promise<RouteExtended>
  /** Executes the route, expecting a rejection, and returns the error. */
  runExpectingFailure(): Promise<Error>
  /** The retry a consumer performs after a failure: `resumeRoute`. */
  retry(): Promise<RouteExtended>
  /** The route as the consumer last saw it through `updateRouteHook`. */
  route(): RouteExtended
  /** The step inside {@link Scenario.route}, after the pipeline mutated it. */
  executedStep(): LiFiStepExtended
  /**
   * Timeline entries of one kind, still carrying their global `seq`. Pass
   * `fromSeq` to look at one leg of a multi-run scenario (e.g. after a retry).
   */
  events<K extends TimelineKind>(
    kind: K,
    fromSeq?: number
  ): TimelineEventOf<K>[]
  /** Every timeline `kind`, in order — handy for pinning a whole sequence. */
  kinds(): TimelineKind[]
  /**
   * `step.execution.actions` as the consumer reads it when the run is over, as
   * `TYPE:STATUS`. This is the array the widget renders; `at(-1)` is the entry
   * it takes its headline text and its icon from. Its order is not the call
   * order the `action` timeline events record — see {@link TimelineEventCommon}.
   */
  finalActions(): string[]
}

const asMock = (fn: unknown, name: string): Mock => {
  const mock = fn as Mock
  if (typeof mock?.mockImplementation !== 'function') {
    throw new Error(
      `${name} is not mocked. Copy the module-boundary vi.mock() preamble documented in harness.ts into this spec.`
    )
  }
  return mock
}

/**
 * Holds the live step the pipeline is mutating, so any observer — including the
 * wallet client, which never sees a step — can read `execution.actions` as a
 * consumer would. `executeRoute` deep-clones the route, so the step a spec
 * built is *not* the object under execution; this is set from the arguments the
 * `StatusManager` is actually called with.
 */
interface ActionsProbe {
  step?: { execution?: { actions: { type: string; status: string }[] } }
  snapshot(): string[]
}

const createActionsProbe = (): ActionsProbe => ({
  step: undefined,
  snapshot(): string[] {
    return (this.step?.execution?.actions ?? []).map(
      (action) => `${action.type}:${action.status}`
    )
  },
})

/**
 * Instruments the executor's `StatusManager` at the two methods that actually
 * mutate an action. `initializeAction` delegates to one of them, so wrapping
 * these two records exactly one entry per real mutation and never double-counts.
 *
 * Each entry is recorded from the *arguments*, before the real method runs, so
 * the mutation lands on the timeline ahead of the `updateRouteHook` fire it
 * causes — the order a consumer actually observes. The entry's `actions`
 * snapshot is then patched in once the real method has returned, so one event
 * carries both the call that was made and the array it produced.
 */
const instrumentStatusManager = (
  executor: object,
  record: (detail: TimelineEventDetail) => TimelineEvent,
  probe: ActionsProbe
): void => {
  const statusManager = (
    executor as {
      statusManager: {
        createAction: (...args: never[]) => unknown
        updateAction: (...args: never[]) => unknown
        updateExecution: (...args: never[]) => unknown
      }
    }
  ).statusManager
  const { createAction, updateAction, updateExecution } = statusManager

  statusManager.createAction = (...args: never[]) => {
    const props = args[0] as unknown as {
      step: ActionsProbe['step']
      type: string
      status: string
    }
    probe.step = props.step
    const event = record({
      kind: 'action',
      actionType: props.type,
      status: props.status,
    })
    const result = createAction.apply(statusManager, args)
    event.actions = probe.snapshot()
    return result
  }
  statusManager.updateAction = (...args: never[]) => {
    const [step, type, status, params] = args as unknown as [
      ActionsProbe['step'],
      string,
      string,
      { txHash?: string; taskId?: string } | undefined,
    ]
    probe.step = step
    const event = record({
      kind: 'action',
      actionType: type,
      status,
      txHash: params?.txHash,
      taskId: params?.taskId,
    })
    const result = updateAction.apply(statusManager, args)
    event.actions = probe.snapshot()
    return result
  }
  statusManager.updateExecution = (...args: never[]) => {
    probe.step = args[0] as unknown as ActionsProbe['step']
    const execution = args[1] as unknown as { status?: string } | undefined
    const event = record({ kind: 'execution', status: execution?.status })
    const result = updateExecution.apply(statusManager, args)
    event.actions = probe.snapshot()
    return result
  }
}

let scenarioCounter = 0

export const createScenario = (options: ScenarioOptions): Scenario => {
  const chain = options.chain ?? buildChain()
  const timeline: TimelineEvent[] = []
  const probe = createActionsProbe()
  const record = (detail: TimelineEventDetail): TimelineEvent => {
    const event = {
      ...detail,
      seq: timeline.length,
      actions: probe.snapshot(),
    } as TimelineEvent
    timeline.push(event)
    return event
  }

  const allowance = options.allowance ?? 0n
  const accountCode = options.accountCode ?? '0x'
  const capabilities = options.capabilities ?? {}
  const erc1271Response = options.erc1271Response ?? ERC1271_ACCEPTED

  let signCallIndex = 0
  let txCounter = 0
  const nextHash = (): Hash => {
    txCounter += 1
    return `0x${txCounter.toString(16).padStart(64, '0')}` as Hash
  }

  // One read handler shared by the wallet client and the public client:
  // `getActionWithFallback` retries a failed wallet read on the public client,
  // so a read that is supposed to fail has to fail on both.
  const readContract = async (
    request: ReadContractRequest
  ): Promise<unknown> => {
    record({
      kind: 'readContract',
      address: request.address,
      functionName: request.functionName,
      args: request.args ?? [],
    })
    switch (request.functionName) {
      case 'allowance':
        return allowance
      case 'nextNonce':
        return PERMIT2_PROXY_NONCE
      case 'eip712Domain':
        if (!options.nativePermitSupported) {
          throw new Error('Token does not implement eip712Domain().')
        }
        return [
          '0x0f',
          TOKEN_EIP712_NAME,
          '1',
          BigInt(chain.id),
          request.address,
          `0x${'00'.repeat(32)}`,
          [],
        ]
      case 'nonces':
        if (!options.nativePermitSupported) {
          throw new Error('Token does not implement nonces().')
        }
        return 0n
      default:
        throw new Error(
          `Token does not implement ${request.functionName}() in this scenario.`
        )
    }
  }

  const multicall = async (): Promise<unknown> => {
    throw new Error(
      'multicall is not configured: the chain fixture has no multicallAddress.'
    )
  }

  const getCode = async ({ address }: { address: Address }): Promise<Hex> => {
    record({ kind: 'getCode', address })
    return accountCode
  }

  const call = async (): Promise<{ data: Hex }> => {
    if (erc1271Response === 'revert') {
      throw new Error('Account reverted the ERC-1271 probe.')
    }
    return { data: erc1271Response }
  }

  const publicClient = {
    chain: { id: chain.id },
    readContract,
    multicall,
    getCode,
    call,
  } as unknown as Client

  const walletClient = {
    account: { address: FROM_ADDRESS, type: 'json-rpc' },
    chain: { id: chain.id },
    transport: { type: 'custom' },
    uid: 'characterization-wallet',
    readContract,
    multicall,
    getCode,
    call,
    getChainId: async (): Promise<number> => chain.id,
    getAddresses: async (): Promise<Address[]> => [FROM_ADDRESS],
    getCapabilities: async (): Promise<Record<string, unknown>> => {
      record({ kind: 'getCapabilities' })
      return capabilities
    },
    estimateGas: async ({ to }: { to?: Address }): Promise<bigint> => {
      record({ kind: 'estimateGas', to })
      return 500_000n
    },
    signTypedData: async (request: SignTypedDataRequest): Promise<Hex> => {
      record({
        kind: 'signTypedData',
        primaryType: request.primaryType,
        domain: request.domain,
        message: request.message,
      })
      const index = signCallIndex
      signCallIndex += 1
      if (options.onSignTypedData) {
        return options.onSignTypedData(request, index)
      }
      return WALLET_SIGNATURE
    },
    sendTransaction: async (request: {
      to?: Address
      data?: Hex
      value?: bigint
    }): Promise<Hash> => {
      record({
        kind: 'sendTransaction',
        to: request.to,
        data: request.data,
        value: request.value,
      })
      return nextHash()
    },
    sendCalls: async (request: {
      calls: { to?: Address; data?: Hex }[]
    }): Promise<{ id: Hex }> => {
      record({
        kind: 'sendCalls',
        calls: request.calls.map((c) => ({ to: c.to, data: c.data })),
      })
      if (options.onSendCalls) {
        return options.onSendCalls(request)
      }
      return { id: nextHash() }
    },
    waitForCallsStatus: async (): Promise<unknown> => ({
      status: 'success',
      statusCode: 200,
      receipts: [{ transactionHash: nextHash(), status: 'success' }],
    }),
  } as unknown as Client

  const baseProvider = EthereumProvider({
    getWalletClient: async () => walletClient,
    switchChain: async () => walletClient,
    disableMessageSigning: options.disableMessageSigning,
  })

  const provider: SDKProvider = {
    ...baseProvider,
    getBalance: async (
      _client: SDKClient,
      _address: string,
      tokens: Token[]
    ): Promise<TokenAmount[]> =>
      tokens.map((token) => ({ ...token, amount: HUGE_BALANCE })),
    async getStepExecutor(executorOptions: StepExecutorOptions) {
      const executor = await baseProvider.getStepExecutor(executorOptions)
      instrumentStatusManager(executor, record, probe)
      return executor
    },
  } as unknown as SDKProvider

  const client = createClient({
    integrator: 'characterization',
    preloadChains: false,
    disableVersionCheck: true,
    providers: [provider],
  })
  client.setChains(
    options.toChain && options.toChain.id !== chain.id
      ? [chain, options.toChain]
      : [chain]
  )

  scenarioCounter += 1
  const routeId = `characterization-route-${scenarioCounter}`
  const route = {
    id: routeId,
    fromChainId: options.step.action.fromChainId,
    toChainId: options.step.action.toChainId,
    fromAmount: options.step.action.fromAmount,
    fromAmountUSD: '1.5',
    fromToken: FROM_TOKEN,
    toToken: TO_TOKEN,
    toAmount: options.step.estimate.toAmount,
    toAmountMin: options.step.estimate.toAmountMin,
    toAmountUSD: '1.49',
    fromAddress: FROM_ADDRESS,
    toAddress: FROM_ADDRESS,
    gasCostUSD: '0.01',
    steps: [options.step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route

  let latestRoute: RouteExtended | undefined
  const executionOptions: ExecutionOptions = {
    updateRouteHook: (updatedRoute: RouteExtended) => {
      latestRoute = updatedRoute
      record({ kind: 'routeUpdate' })
    },
    ...(options.executeInBackground !== undefined && {
      executeInBackground: options.executeInBackground,
    }),
  }

  asMock(getStepTransaction, 'getStepTransaction').mockImplementation(
    async (_client: SDKClient, requestedStep: LiFiStep) => {
      record({ kind: 'getStepTransaction' })
      if (options.onStepTransaction) {
        return options.onStepTransaction(requestedStep)
      }
      const { typedData: _typedData, ...rest } = requestedStep
      return rest
    }
  )
  asMock(getRelayerQuote, 'getRelayerQuote').mockImplementation(async () => {
    record({ kind: 'getRelayerQuote' })
    const answer = options.onRelayerQuote
      ? options.onRelayerQuote(options.step)
      : options.step
    // The relayer endpoint answers with a whole step; strip the live execution
    // object the way a fresh API response would not carry one.
    const { execution: _execution, ...rest } = answer as LiFiStepExtended
    return rest
  })
  asMock(relayTransaction, 'relayTransaction').mockImplementation(
    async (
      _client: SDKClient,
      relayedStep: { typedData: SignedTypedData[] }
    ) => {
      record({ kind: 'relayTransaction', typedData: relayedStep.typedData })
      return { taskId: RELAY_TASK_ID, txLink: 'https://relayer.example/task' }
    }
  )
  asMock(getPublicClient, 'getPublicClient').mockResolvedValue(publicClient)
  asMock(
    waitForTransactionReceipt,
    'waitForTransactionReceipt'
  ).mockImplementation(async () => ({
    transactionHash: nextHash(),
    status: 'success',
  }))
  asMock(
    waitForRelayedTransactionReceipt,
    'waitForRelayedTransactionReceipt'
  ).mockImplementation(async () => ({
    status: 'success',
    transactionHash: nextHash(),
    transactionLink: 'https://polygonscan.example/tx',
  }))

  const requireRoute = (): RouteExtended => {
    if (!latestRoute) {
      throw new Error('The route hook never fired; nothing was executed.')
    }
    return latestRoute
  }

  return {
    timeline,
    run: () => executeRoute(client, route, executionOptions),
    async runExpectingFailure(): Promise<Error> {
      try {
        await executeRoute(client, route, executionOptions)
      } catch (error) {
        return error as Error
      }
      throw new Error('Expected the route execution to fail, but it succeeded.')
    },
    retry: () => resumeRoute(client, requireRoute(), executionOptions),
    route: requireRoute,
    executedStep: () => requireRoute().steps[0],
    events<K extends TimelineKind>(kind: K, fromSeq = 0): TimelineEventOf<K>[] {
      return timeline.filter(
        (event): event is TimelineEventOf<K> =>
          event.kind === kind && event.seq >= fromSeq
      )
    },
    kinds: () => timeline.map((event) => event.kind),
    finalActions: () =>
      (requireRoute().steps[0].execution?.actions ?? []).map(
        (action) => `${action.type}:${action.status}`
      ),
  }
}
