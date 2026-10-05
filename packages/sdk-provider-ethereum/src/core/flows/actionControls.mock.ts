/**
 * What the action-level harness (`harness.mock.ts`) cannot do, added without
 * editing it.
 *
 * The harness builds its wallet client, its `EthereumProvider` and its
 * execution options inside `createScenario`, so a spec cannot reach them.
 * These controls reach them at the module boundary the harness imports:
 *
 * - {@link mockEthereumProviderModule} wraps `EthereumProvider` from
 *   `../../EthereumProvider.js`. The wrapper puts {@link walletControls}
 *   between the SDK and the harness wallet: the user can reject a
 *   `sendTransaction`, the wallet can start on another chain, and an
 *   `acceptExchangeRateUpdateHook` reaches the executor's execution options.
 *   Every spec that uses it needs this preamble:
 *
 *   ```ts
 *   vi.mock('../../EthereumProvider.js', async (importOriginal) =>
 *     (await import('./actionControls.mock.js')).mockEthereumProviderModule(
 *       await importOriginal()
 *     )
 *   )
 *   ```
 *
 *   This module must never value-import `../../EthereumProvider.js` or
 *   `./harness.mock.js`: the mock factory above imports it while the
 *   provider module is being mocked.
 * - {@link createStatusApi} is a `fetch` fake for `/v1/status`, so the real
 *   `WaitForTransactionStatusTask` runs and the step reaches `DONE`.
 * - {@link recordRouteUpdates} wraps `executeRoute` and `resumeRoute` from
 *   `@lifi/sdk`, so every `updateRouteHook` fire is copied before the
 *   harness hook runs. {@link routeUpdateSequence} is the §4.2.2 sequence,
 *   read off these copies. Every spec that calls it needs this addition in
 *   its `vi.mock('@lifi/sdk')` factory:
 *
 *   ```ts
 *   vi.mock('@lifi/sdk', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('@lifi/sdk')>()
 *     return {
 *       ...actual,
 *       ...(await import('./actionControls.mock.js')).recordRouteUpdates(
 *         actual
 *       ),
 *       getStepTransaction: vi.fn(),
 *       getRelayerQuote: vi.fn(),
 *       relayTransaction: vi.fn(),
 *     }
 *   })
 *   ```
 *
 *   For the same reason, this module must never value-import `@lifi/sdk`.
 *
 * `.mock.ts` keeps this file out of `dist`.
 */
import type * as LiFiSdk from '@lifi/sdk'
import type {
  AcceptExchangeRateUpdateHook,
  ExecutionOptions,
  RouteExtended,
  StepExecutorOptions,
  Token,
} from '@lifi/sdk'
import { type Client, type Hex, UserRejectedRequestError } from 'viem'
import { getTransactionError } from 'viem/utils'
import type * as EthereumProviderModule from '../../EthereumProvider.js'
import type { EthereumProviderOptions } from '../../types.js'
import type { Scenario } from './harness.mock.js'
import { dedupeActionPairs } from './routeUpdates.mock.js'

// ---------------------------------------------------------------------------
// Wallet controls
// ---------------------------------------------------------------------------

/** One `sendTransaction` prompt the wallet showed, rejected ones included. */
export interface SendAttempt {
  to?: string
  data?: Hex
  value?: bigint
  rejected: boolean
}

export interface WalletControls {
  /** Every `sendTransaction` prompt, in order. */
  readonly sendAttempts: SendAttempt[]
  /** The user rejects this many of the next `sendTransaction` prompts. */
  rejectSends: number
  /**
   * The chain that every wallet from `getWalletClient` reports, not only the
   * first one. `undefined` keeps the harness wallet's chain. The wallet that
   * `switchChain` returns always reports the harness chain.
   */
  startChainId: number | undefined
  /** Chain ids the SDK asked the wallet to switch to, in order. */
  readonly switches: number[]
  /**
   * `switchChain:<id>` and `sendTransaction` entries in the order the wallet
   * saw them.
   */
  readonly log: string[]
  /** Reaches the executor's execution options when set. */
  acceptExchangeRateUpdateHook: AcceptExchangeRateUpdateHook | undefined
  /** Back to a wallet that accepts everything on the harness chain. */
  reset(): void
}

export const walletControls: WalletControls = {
  sendAttempts: [],
  rejectSends: 0,
  startChainId: undefined,
  switches: [],
  log: [],
  acceptExchangeRateUpdateHook: undefined,
  reset() {
    this.sendAttempts.length = 0
    this.rejectSends = 0
    this.startChainId = undefined
    this.switches.length = 0
    this.log.length = 0
    this.acceptExchangeRateUpdateHook = undefined
  },
}

type SendTransaction = (request: {
  to?: string
  data?: Hex
  value?: bigint
}) => Promise<Hex>

/**
 * The harness wallet, seen through {@link walletControls}. With `chainId`,
 * this wallet reports that chain. `getWalletClient` passes `startChainId` on
 * every call, so a wallet that the SDK gets later (a retry, a second step)
 * reports the start chain again, also after a switch. A real wallet stays on
 * the chain it switched to.
 */
const controlledWallet = (harnessWallet: Client, chainId?: number): Client => {
  const harness = harnessWallet as unknown as {
    sendTransaction: SendTransaction
  }
  return {
    ...harnessWallet,
    ...(chainId !== undefined && {
      chain: { id: chainId },
      getChainId: async (): Promise<number> => chainId,
    }),
    sendTransaction: async (
      request: Parameters<SendTransaction>[0]
    ): Promise<Hex> => {
      const rejected = walletControls.rejectSends > 0
      walletControls.log.push('sendTransaction')
      walletControls.sendAttempts.push({
        to: request.to,
        data: request.data,
        value: request.value,
        rejected,
      })
      if (rejected) {
        walletControls.rejectSends -= 1
        // What viem's `sendTransaction` action throws for an EIP-1193 4001
        // answer: `getTransactionError` wraps the `UserRejectedRequestError`
        // in a `TransactionExecutionError`. The wallet text (MetaMask's) must
        // not contain "rejected": `parseEthereumErrors` maps a
        // `TransactionExecutionError` whose `details` contain "rejected" to
        // SignatureRejected (the Safe branch), which would hide the
        // `e.cause?.name` branch that real wallets reach.
        throw getTransactionError(
          new UserRejectedRequestError(
            new Error(
              'MetaMask Tx Signature: User denied transaction signature.'
            )
          ),
          { account: null }
        )
      }
      return harness.sendTransaction(request)
    },
  } as unknown as Client
}

/** The `vi.mock('../../EthereumProvider.js')` factory body. */
export const mockEthereumProviderModule = (
  actual: typeof EthereumProviderModule
): typeof EthereumProviderModule => ({
  ...actual,
  EthereumProvider: (options?: EthereumProviderOptions) => {
    const provider = actual.EthereumProvider({
      ...options,
      getWalletClient: async () => {
        const wallet = await options?.getWalletClient?.()
        if (!wallet) {
          throw new Error('The harness passed no wallet client.')
        }
        return controlledWallet(wallet, walletControls.startChainId)
      },
      switchChain: async (chainId: number) => {
        walletControls.switches.push(chainId)
        walletControls.log.push(`switchChain:${chainId}`)
        const wallet = await options?.switchChain?.(chainId)
        return wallet && controlledWallet(wallet)
      },
    })
    const getStepExecutor = provider.getStepExecutor
    provider.getStepExecutor = (executorOptions: StepExecutorOptions) =>
      getStepExecutor({
        ...executorOptions,
        executionOptions: {
          ...executorOptions.executionOptions,
          ...(walletControls.acceptExchangeRateUpdateHook && {
            acceptExchangeRateUpdateHook:
              walletControls.acceptExchangeRateUpdateHook,
          }),
        },
      })
    return provider
  },
})

// ---------------------------------------------------------------------------
// The LI.FI `/status` endpoint
// ---------------------------------------------------------------------------

export interface StatusApiOptions {
  /** `receiving.chainId`: the source chain for a same-chain swap. */
  chainId: number
  /** `sending.amount`, i.e. the step's final `execution.fromAmount`. */
  fromAmount: string
  /** `receiving.token`. */
  toToken: Token
  /** `receiving.amount`, i.e. the step's final `execution.toAmount`. */
  toAmount: string
}

export interface StatusApi {
  /** Install with `vi.stubGlobal('fetch', statusApi.fetch)`. */
  readonly fetch: typeof fetch
  /** The query of every `/v1/status` request, in order. */
  readonly queries: Record<string, string>[]
  /**
   * Every other URL, and every throw inside the fake as
   * `harness error: fetch on <url>: <message>`. Must stay empty.
   */
  readonly unknown: string[]
}

/**
 * `GET /v1/status` answers `DONE` on the first poll for whatever hash it is
 * asked about; for a same-chain swap the receiving transaction is the sent
 * one. `status: 'DONE'` on the first poll matters: anything else makes
 * `waitForResult` sleep 5 seconds.
 *
 * A throw inside the fake (a request it cannot parse) is recorded in
 * `unknown` before the request rejects: the status poll
 * (`waitForTransactionStatus`) swallows a rejected request and polls again,
 * with no limit, so the throw would otherwise show only as a test timeout.
 */
export const createStatusApi = (options: StatusApiOptions): StatusApi => {
  const answer = (href: string): Response => {
    const url = new URL(href)
    if (url.pathname !== '/v1/status') {
      api.unknown.push(url.href)
      return new Response('{}', { status: 404 })
    }
    const query = Object.fromEntries(url.searchParams.entries())
    api.queries.push(query)
    const txHash = query.txHash
    return new Response(
      JSON.stringify({
        status: 'DONE',
        substatus: 'COMPLETED',
        substatusMessage: 'The transfer is complete.',
        transactionId: `status-${txHash}`,
        lifiExplorerLink: `https://explorer.example/tx/${txHash}`,
        sending: {
          txHash,
          amount: options.fromAmount,
          gasAmount: '10000',
          gasAmountUSD: '0.01',
          gasPrice: '1',
          gasToken: options.toToken,
          gasUsed: '21000',
        },
        receiving: {
          txHash,
          txLink: `https://polygonscan.example/tx/${txHash}`,
          amount: options.toAmount,
          chainId: options.chainId,
          token: options.toToken,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  const api: StatusApi = {
    queries: [],
    unknown: [],
    fetch: (async (input: unknown) => {
      const href =
        typeof input === 'string'
          ? input
          : ((input as Request | undefined)?.url ?? String(input))
      try {
        return answer(href)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        api.unknown.push(`harness error: fetch on ${href}: ${message}`)
        throw error
      }
    }) as typeof fetch,
  }
  return api
}

// ---------------------------------------------------------------------------
// What the consumer saw
// ---------------------------------------------------------------------------

/**
 * Every `updateRouteHook` fire, by route id: the first step's
 * `execution.actions` as `TYPE:STATUS`, copied through JSON inside the hook.
 * The harness gives every scenario its own route id, and a retry keeps it,
 * so one entry holds every leg of a scenario.
 */
const routeUpdateFires = new Map<string, string[][]>()

const withRecordingHook = (
  routeId: string,
  executionOptions: ExecutionOptions | undefined
): ExecutionOptions => {
  const fires = routeUpdateFires.get(routeId) ?? []
  routeUpdateFires.set(routeId, fires)
  return {
    ...executionOptions,
    updateRouteHook: (route: RouteExtended) => {
      const actions: { type: string; status: string }[] = JSON.parse(
        JSON.stringify(route.steps[0]?.execution?.actions ?? [])
      )
      fires.push(actions.map(({ type, status }) => `${type}:${status}`))
      executionOptions?.updateRouteHook?.(route)
    },
  }
}

/**
 * `executeRoute` and `resumeRoute` for the `vi.mock('@lifi/sdk')` factory
 * (see the preamble at the top of this file). The harness calls them with
 * its own `updateRouteHook`; they add a hook that copies what the consumer
 * receives and then calls the harness hook.
 */
export const recordRouteUpdates = (
  actual: typeof LiFiSdk
): Pick<typeof LiFiSdk, 'executeRoute' | 'resumeRoute'> => ({
  executeRoute: (client, route, executionOptions) =>
    actual.executeRoute(
      client,
      route,
      withRecordingHook(route.id, executionOptions)
    ),
  resumeRoute: (client, route, executionOptions) =>
    actual.resumeRoute(
      client,
      route,
      withRecordingHook(route.id, executionOptions)
    ),
})

/**
 * The §4.2.2 sequence of a harness scenario, from what `updateRouteHook`
 * received ({@link recordRouteUpdates}). `fromSeq` reads one leg of a run
 * that was retried: the leg starts from the last fire before `fromSeq`,
 * i.e. from what the consumer saw last, not from an empty step.
 */
export const routeUpdateSequence = (
  scenario: Scenario,
  fromSeq = 0
): string[] => {
  const fires = routeUpdateFires.get(scenario.route().id) ?? []
  const harnessFires = scenario.events('routeUpdate')
  if (fires.length !== harnessFires.length) {
    throw new Error(
      `Copied ${fires.length} updateRouteHook fires, the harness saw ${harnessFires.length}. Add recordRouteUpdates to the vi.mock('@lifi/sdk') factory of this spec.`
    )
  }
  const legStart = harnessFires.findIndex((event) => event.seq >= fromSeq)
  if (legStart === -1) {
    return []
  }
  return dedupeActionPairs(fires.slice(legStart), fires[legStart - 1])
}
