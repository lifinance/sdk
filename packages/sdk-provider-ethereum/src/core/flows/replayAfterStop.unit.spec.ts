import { getActiveRoute, type LiFiStep, stopRouteExecution } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The terminal destination-status watcher polls `getStatus` over HTTP on a
    // 5s interval and never settles under test. It runs after everything these
    // specs assert on; the rest of the pipeline stays real.
    WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
      shouldRun = async (): Promise<boolean> => true
      run = async (): Promise<{ status: 'COMPLETED' }> => ({
        status: 'COMPLETED',
      })
    },
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import {
  buildStep,
  buildTransactionRequest,
  buildTypedData,
  CHAIN_ID,
  createScenario,
  FROM_ADDRESS,
  type Scenario,
  type TimelineKind,
} from './harness.mock.js'

// A batched first run whose re-quote moves the step to another strategy asks
// `executeRoute` for a replay (JUMEMB-102). A stop during that re-quote ends
// the run: the replay would re-quote, read the chain and call integrator
// callbacks on a stopped executor.

/** A limit order the tool builds at `/stepTransaction`, not at routes time. */
const ORDER_TYPED_DATA = buildTypedData({
  primaryType: 'Order',
  domain: { name: 'Limit Order Protocol', chainId: CHAIN_ID },
  message: { maker: FROM_ADDRESS, salt: '1' },
})

/** The re-quotes that move a batched step to another strategy. */
const REQUOTES: {
  strategy: string
  requote: (step: LiFiStep) => LiFiStep
}[] = [
  {
    // The C15 shape of `signatureOnlyAtPrepare.flow.spec.ts`: an order only.
    strategy: 'relayed',
    requote: (step) => {
      const { transactionRequest: _dropped, ...rest } = step
      return { ...rest, typedData: [ORDER_TYPED_DATA] }
    },
  },
  {
    // A tool that never batches.
    strategy: 'standard',
    requote: (step) => ({
      ...step,
      tool: 'thorswap',
      transactionRequest: buildTransactionRequest(),
    }),
  },
]

/**
 * A custom step (CoW) with an approval to queue and an EIP-5792 wallet, so
 * the first run is batched. `gate` holds every re-quote.
 */
const buildBatchedScenario = (
  requote: (step: LiFiStep) => LiFiStep,
  gate: Promise<void>,
  onRouteUpdate?: () => void
): Scenario =>
  createScenario({
    step: buildStep({
      type: 'jumper',
      tool: 'cowswap',
      approvalAddress: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
    }),
    allowance: 0n,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: async (step) => {
      await gate
      return requote(step)
    },
    onRouteUpdate,
  })

/** The timeline kinds that record no wallet, RPC or API call. */
const NO_CALL_KINDS: ReadonlySet<TimelineKind> = new Set<TimelineKind>([
  'action',
  'execution',
  'routeUpdate',
])

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EVM replay after prepare: stopRouteExecution during the re-quote', () => {
  it.each(REQUOTES)(
    'starts no replay in $strategy after the stop',
    async ({ requote }) => {
      const requoted = Promise.withResolvers<void>()
      let hookCalls = 0
      const scenario = buildBatchedScenario(requote, requoted.promise, () => {
        hookCalls += 1
      })

      const running = scenario.run()
      await vi.waitFor(() =>
        expect(scenario.events('getStepTransaction')).toHaveLength(1)
      )
      const stopFrom = scenario.timeline.length
      const hookCallsAtStop = hookCalls
      stopRouteExecution(scenario.route())
      requoted.resolve()

      // The run resolves like any stopped step, it does not fail.
      await expect(running).resolves.toBeDefined()
      expect(scenario.events('getStepTransaction')).toHaveLength(1)
      // The whole slice, not a list of kinds: no wallet request, re-quote,
      // contract read, `getCode`, capability read or gas estimate.
      expect(
        scenario
          .kinds()
          .slice(stopFrom)
          .filter((kind) => !NO_CALL_KINDS.has(kind))
      ).toEqual([])
      expect(hookCalls).toBe(hookCallsAtStop)
      expect(getActiveRoute(scenario.route().id)).toBeUndefined()
    }
  )

  // Fixture guard: without the stop, the same first run replays.
  it.each(REQUOTES)(
    'replays in $strategy without a stop',
    async ({ requote }) => {
      const scenario = buildBatchedScenario(requote, Promise.resolve())

      await expect(scenario.run()).resolves.toBeDefined()

      expect(scenario.events('getStepTransaction')).toHaveLength(2)
      expect(scenario.events('sendCalls')).toEqual([])
    }
  )
})
