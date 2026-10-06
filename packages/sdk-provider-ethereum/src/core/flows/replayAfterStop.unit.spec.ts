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
  APPROVAL_ADDRESS,
  buildStep,
  buildTransactionRequest,
  buildTypedData,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  createScenario,
  FROM_ADDRESS,
  type Scenario,
  type ScenarioOptions,
  type StepFixtureOptions,
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

/** A custom step (CoW), as a limit-order backend builds it. */
const CUSTOM_STEP: StepFixtureOptions = {
  type: 'jumper',
  tool: 'cowswap',
  approvalAddress: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
}

/** The C15 shape of `signatureOnlyAtPrepare.flow.spec.ts`: an order only. */
const toOrder = (step: LiFiStep): LiFiStep => {
  const { transactionRequest: _dropped, ...rest } = step
  return { ...rest, typedData: [ORDER_TYPED_DATA] }
}

type Shape = {
  shape: string
  step: StepFixtureOptions
  allowance: Pick<ScenarioOptions, 'allowance' | 'allowanceBySpender'>
  requote: (step: LiFiStep) => LiFiStep
}

/** Batched first runs whose re-quote moves the step to another strategy. */
const SHAPES: Shape[] = [
  {
    shape: 'a custom step with a queued approval, re-quoted to relayed',
    step: CUSTOM_STEP,
    allowance: { allowance: 0n },
    requote: toOrder,
  },
  {
    // A tool that never batches.
    shape: 'a custom step with a queued approval, re-quoted to standard',
    step: CUSTOM_STEP,
    allowance: { allowance: 0n },
    requote: (step) => ({
      ...step,
      tool: 'thorswap',
      transactionRequest: buildTransactionRequest(),
    }),
  },
  {
    // Nothing is queued, and only the spender changes: the relayed lane pulls
    // through Permit2. Both spenders hold an allowance, so a replay passes the
    // allowance tasks and re-quotes.
    shape: 'a LI.FI step with both spenders approved, re-quoted to relayed',
    step: {},
    allowance: {
      allowanceBySpender: {
        [APPROVAL_ADDRESS]: 10n ** 24n,
        [CANONICAL_PERMIT2]: 10n ** 24n,
      },
    },
    requote: toOrder,
  },
]

/**
 * `shape` on an EIP-5792 wallet, so the first run is batched. `gate` holds
 * every re-quote.
 */
const buildBatchedScenario = (
  { step, allowance, requote }: Shape,
  gate: Promise<void>,
  onRouteUpdate?: () => void
): Scenario =>
  createScenario({
    step: buildStep(step),
    ...allowance,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: async (requoted) => {
      await gate
      return requote(requoted)
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
  it.each(SHAPES)('starts no replay after the stop: $shape', async (shape) => {
    const requoted = Promise.withResolvers<void>()
    let hookCalls = 0
    const scenario = buildBatchedScenario(shape, requoted.promise, () => {
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
    // Context, not the replay check: the stop itself ends hook updates and
    // drops the active route, with or without a replay.
    expect(hookCalls).toBe(hookCallsAtStop)
    expect(getActiveRoute(scenario.route().id)).toBeUndefined()
  })

  // Fixture guard: without the stop, the same first run replays.
  it.each(SHAPES)('replays without a stop: $shape', async (shape) => {
    const scenario = buildBatchedScenario(shape, Promise.resolve())

    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('getStepTransaction')).toHaveLength(2)
    expect(scenario.events('sendCalls')).toEqual([])
  })
})
