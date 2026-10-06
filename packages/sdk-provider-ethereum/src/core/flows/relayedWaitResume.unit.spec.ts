import {
  type ExecutionAction,
  getRelayedTransactionStatus,
  hasOpenTransaction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type RouteExtended,
  type StatusManager,
  stopRouteExecution,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The relayer status that the real relayed wait polls.
    getRelayedTransactionStatus: vi.fn(),
    // The terminal destination-status watcher polls `getStatus` over HTTP.
    // Here it stands for a `/status` answer of DONE, so a step that gets this
    // far completes and the route ends.
    WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
      shouldRun = async (): Promise<boolean> => true
      run = async (context: {
        step: LiFiStepExtended
        statusManager: StatusManager
      }): Promise<{ status: 'COMPLETED' }> => {
        context.statusManager.updateExecution(context.step, { status: 'DONE' })
        return { status: 'COMPLETED' }
      }
    },
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import {
  buildChain,
  buildPermitTypedData,
  buildPermitWitnessTypedData,
  buildStep,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  createScenario,
  RELAY_TASK_ID,
  type Scenario,
  type TimelineKind,
} from './harness.mock.js'

// The relayed wait ends after 24 hours, and on `stopRouteExecution`. Neither
// end is an outcome of the relayed transaction: the relayer may still execute
// it. So the action keeps its task id and gets no `txFinal`, and a resume
// ("Try again", or a reload) waits for the same task. A second signature
// would be a second payment if the first task executes later.

const DAY_MS = 24 * 60 * 60_000

/** Arbitrum. A destination other than the source chain makes a bridge. */
const DESTINATION_CHAIN_ID = 42161

/** The hash the relayer reports once the task executed. */
const RELAYED_TX_HASH: Hash = `0x${'5e'.repeat(32)}`

/** Widget persistence: what `updateRouteHook` wrote to storage. */
const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

/** The action that holds the task id: SWAP, or CROSS_CHAIN for a bridge. */
type RelayedActionType = 'SWAP' | 'CROSS_CHAIN'

const relayedActionOf = (
  route: RouteExtended,
  actionType: RelayedActionType = 'SWAP'
): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === actionType)

type Outcome = {
  settled: boolean
  resolved?: boolean
  value?: RouteExtended
  error?: unknown
}

// Records how a run settles without awaiting it, so a run that never ends
// fails the assertions instead of hanging the test.
const track = (promise: Promise<RouteExtended>): Outcome => {
  const outcome: Outcome = { settled: false }
  promise.then(
    (value) => {
      Object.assign(outcome, { settled: true, resolved: true, value })
    },
    (error: unknown) => {
      Object.assign(outcome, { settled: true, resolved: false, error })
    }
  )
  return outcome
}

/**
 * The gasless shape of `gaslessTwoEntries.flow.spec.ts`: the relayer executes
 * the step, and the SWAP action holds the relayer's task id. With
 * `toChainId`, the step is a bridge and the CROSS_CHAIN action holds it.
 */
const buildRelayedScenario = async (
  onRouteUpdate?: (route: RouteExtended) => void,
  toChainId?: number
): Promise<Scenario> => {
  const scenario = createScenario({
    step: buildStep({
      typedData: [
        buildPermitTypedData(CANONICAL_PERMIT2),
        buildPermitWitnessTypedData(),
      ],
      toChainId,
    }),
    ...(toChainId !== undefined && { toChain: buildChain({ id: toChainId }) }),
    allowance: 0n,
    onRouteUpdate,
  })
  // `createScenario` installs a relayed wait that answers at once. This spec
  // needs the real one: it polls the relayer status mocked above.
  const actual = await vi.importActual<
    typeof import('../../actions/waitForRelayedTransactionReceipt.js')
  >('../../actions/waitForRelayedTransactionReceipt.js')
  vi.mocked(waitForRelayedTransactionReceipt).mockImplementation(
    actual.waitForRelayedTransactionReceipt
  )
  return scenario
}

const relayerAnswersPending = (): void => {
  vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
    status: 'PENDING',
  } as never)
}

const relayerAnswersDone = (): void => {
  vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
    status: 'DONE',
    metadata: { txHash: RELAYED_TX_HASH },
  } as never)
}

const relayerCalls = (): number =>
  vi.mocked(getRelayedTransactionStatus).mock.calls.length

/** The timeline kinds that record no wallet, RPC or API call. */
const NO_CALL_KINDS: ReadonlySet<TimelineKind> = new Set<TimelineKind>([
  'action',
  'execution',
  'routeUpdate',
])

/**
 * A resume of `stored` that must wait for the relayer task of the first run:
 * no signature, no transaction, no re-quote, no new relay request, and no
 * other wallet or API call.
 */
const expectResumeWaitsForTheSameTask = async (
  scenario: Scenario,
  stored: RouteExtended,
  actionType: RelayedActionType = 'SWAP'
): Promise<void> => {
  relayerAnswersDone()
  vi.mocked(getRelayedTransactionStatus).mockClear()
  const resumeFrom = scenario.timeline.length

  const resumed = track(scenario.resume(stored))
  await vi.advanceTimersByTimeAsync(0)

  expect(resumed).toMatchObject({ settled: true, resolved: true })
  // The whole slice, not a list of kinds: the resume records only status
  // writes. No signature, transaction, batch, relay request, re-quote,
  // contract read, `getCode`, capability read or gas estimate.
  expect(
    scenario
      .kinds()
      .slice(resumeFrom)
      .filter((kind) => !NO_CALL_KINDS.has(kind))
  ).toEqual([])
  // The relayed lane, not the standard one: a standard receipt wait would
  // also sign nothing.
  expect(waitForTransactionReceipt).not.toHaveBeenCalled()
  expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(1)
  expect(getRelayedTransactionStatus).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ taskId: RELAY_TASK_ID }),
    expect.anything()
  )

  // The relayer answered DONE: the route completes.
  const route = resumed.value!
  expect(route.steps[0].execution?.status).toBe('DONE')
  expect(relayedActionOf(route, actionType)).toMatchObject({
    taskId: RELAY_TASK_ID,
    txHash: RELAYED_TX_HASH,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EVM relayed wait: 24 hour deadline', () => {
  it.each<{ actionType: RelayedActionType; toChainId?: number }>([
    { actionType: 'SWAP' },
    { actionType: 'CROSS_CHAIN', toChainId: DESTINATION_CHAIN_ID },
  ])(
    'fails the $actionType step without a final outcome, and "Try again" waits for the same task',
    async ({ actionType, toChainId }) => {
      let stored: RouteExtended | undefined
      const scenario = await buildRelayedScenario((route) => {
        stored = persist(route)
      }, toChainId)
      relayerAnswersPending()
      const start = Date.now()

      const run = track(scenario.run())
      await vi.advanceTimersByTimeAsync(0)
      expect(scenario.events('relayTransaction')).toHaveLength(1)
      expect(relayerCalls()).toBe(1)
      // The relayer is asked for the task on the step's own chains.
      expect(getRelayedTransactionStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskId: RELAY_TASK_ID,
          fromChain: CHAIN_ID,
          toChain: toChainId ?? CHAIN_ID,
        }),
        expect.anything()
      )

      // Move the clock to 10 s before the deadline instead of running 17 000
      // polls. Pending timers keep their delays.
      vi.setSystemTime(start + DAY_MS - 10_000)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(run.settled).toBe(false)

      await vi.advanceTimersByTimeAsync(15_000)

      expect(run).toMatchObject({ settled: true, resolved: false })
      expect(run.error).toMatchObject({ code: LiFiErrorCode.TransactionFailed })
      // The wait left nothing behind.
      expect(vi.getTimerCount()).toBe(0)
      const callsAtDeadline = relayerCalls()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(relayerCalls()).toBe(callsAtDeadline)

      // What storage holds: FAILED, but with the task id and no `txFinal`, so
      // the transaction is still open.
      const action = relayedActionOf(stored!, actionType)
      expect(action).toMatchObject({
        status: 'FAILED',
        taskId: RELAY_TASK_ID,
        error: {
          code: LiFiErrorCode.TransactionFailed,
          message: 'Relayed transaction timed out waiting for a result.',
        },
      })
      expect(action?.txFinal).toBeUndefined()
      expect(hasOpenTransaction(action)).toBe(true)

      await expectResumeWaitsForTheSameTask(scenario, stored!, actionType)
      expect(scenario.events('relayTransaction')).toHaveLength(1)
      expect(scenario.events('signTypedData')).toHaveLength(2)
    }
  )
})

describe('EVM relayed wait: stopRouteExecution', () => {
  it('stops polling the relayer, writes nothing, and a resume waits for the same task', async () => {
    let stored: RouteExtended | undefined
    let hookCalls = 0
    const scenario = await buildRelayedScenario((route) => {
      stored = persist(route)
      hookCalls += 1
    })
    relayerAnswersPending()

    const run = track(scenario.run())
    await vi.advanceTimersByTimeAsync(12_000)
    expect(relayerCalls()).toBe(3)
    const storedAtStop = stored!
    const hookCallsAtStop = hookCalls
    expect(relayedActionOf(storedAtStop)).toMatchObject({
      status: 'PENDING',
      taskId: RELAY_TASK_ID,
    })

    stopRouteExecution(scenario.route())
    await vi.advanceTimersByTimeAsync(0)

    // The task paused: the run resolves like any stopped step, it does not
    // fail.
    expect(run).toMatchObject({ settled: true, resolved: true })
    // The route it resolves with, which an integrator may also store: the same
    // open transaction, and no FAILED, not even in memory.
    const resolvedSwap = relayedActionOf(run.value!)
    expect(resolvedSwap).toMatchObject({
      status: 'PENDING',
      taskId: RELAY_TASK_ID,
    })
    expect(resolvedSwap?.error).toBeUndefined()
    expect(resolvedSwap?.txFinal).toBeUndefined()
    expect(run.value!.steps[0].execution?.status).not.toBe('FAILED')
    // No more relayer requests, and no timer left.
    const callsAtStop = relayerCalls()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(relayerCalls()).toBe(callsAtStop)
    expect(vi.getTimerCount()).toBe(0)

    // Storage is unchanged: the action stays PENDING with its task id, no
    // FAILED and no `txFinal`.
    expect(hookCalls).toBe(hookCallsAtStop)
    expect(stored).toEqual(storedAtStop)
    const swap = relayedActionOf(stored!)
    expect(swap?.status).toBe('PENDING')
    expect(swap?.txFinal).toBeUndefined()
    expect(swap?.error).toBeUndefined()
    expect(stored!.steps[0].execution?.status).not.toBe('FAILED')

    await expectResumeWaitsForTheSameTask(scenario, stored!)
    expect(scenario.events('relayTransaction')).toHaveLength(1)
    expect(scenario.events('signTypedData')).toHaveLength(2)
  })
})
