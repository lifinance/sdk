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
 * - {@link routeUpdateSequence} is the §4.2.2 sequence, read off the
 *   harness timeline.
 *
 * `.mock.ts` keeps this file out of `dist`.
 */
import type {
  AcceptExchangeRateUpdateHook,
  StepExecutorOptions,
  Token,
} from '@lifi/sdk'
import { type Client, type Hex, UserRejectedRequestError } from 'viem'
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
   * The chain the wallet is connected to when the page opens. `undefined`
   * keeps the harness wallet's chain.
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
 * The harness wallet, seen through {@link walletControls}. `chainId` makes
 * the wallet report that chain until the SDK switches it.
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
        // What viem raises for an EIP-1193 4001 answer.
        throw new UserRejectedRequestError(
          new Error('User rejected the request.')
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
  /** Every other URL. Must stay empty. */
  readonly unknown: string[]
}

/**
 * `GET /v1/status` answers `DONE` on the first poll for whatever hash it is
 * asked about; for a same-chain swap the receiving transaction is the sent
 * one. `status: 'DONE'` on the first poll matters: anything else makes
 * `waitForResult` sleep 5 seconds.
 */
export const createStatusApi = (options: StatusApiOptions): StatusApi => {
  const api: StatusApi = {
    queries: [],
    unknown: [],
    fetch: (async (input: unknown) => {
      const url = new URL(
        typeof input === 'string' ? input : (input as Request).url
      )
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
    }) as typeof fetch,
  }
  return api
}

// ---------------------------------------------------------------------------
// What the consumer saw
// ---------------------------------------------------------------------------

/**
 * The §4.2.2 sequence of a harness scenario: every `routeUpdate` timeline
 * entry carries the step's actions at that fire. `fromSeq` reads one leg of
 * a run that was retried.
 */
export const routeUpdateSequence = (
  scenario: Scenario,
  fromSeq = 0
): string[] =>
  dedupeActionPairs(
    scenario.events('routeUpdate', fromSeq).map((event) => event.actions)
  )
