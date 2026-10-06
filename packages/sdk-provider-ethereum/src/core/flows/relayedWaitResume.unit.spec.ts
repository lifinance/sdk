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
// The batched wait calls the wallet's `waitForCallsStatus`, which the harness
// does not record. The mock makes that lane visible to the assertions.
vi.mock('../../actions/waitForBatchTransactionReceipt.js')

import type { LiFiStep } from '@lifi/sdk'
import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import {
  buildChain,
  buildPermitTypedData,
  buildPermitWitnessTypedData,
  buildStep,
  buildTypedData,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  createScenario,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  futureDeadline,
  RELAY_TASK_ID,
  type Scenario,
  THIRD_PARTY_ROUTER,
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
  await useTheRealRelayedWait()
  return scenario
}

/**
 * `createScenario` installs a relayed wait that answers at once. This spec
 * needs the real one: it polls the relayer status mocked above.
 */
const useTheRealRelayedWait = async (): Promise<void> => {
  const actual = await vi.importActual<
    typeof import('../../actions/waitForRelayedTransactionReceipt.js')
  >('../../actions/waitForRelayedTransactionReceipt.js')
  vi.mocked(waitForRelayedTransactionReceipt).mockImplementation(
    actual.waitForRelayedTransactionReceipt
  )
}

/**
 * The C2 shape of `signatureOnlyStep.flow.spec.ts`: a Permit2 `PermitSingle`
 * for a third-party router, and a re-quote with typed data and no
 * `transactionRequest`. The step content alone does not make it relayed:
 * only prepare, which sees that nothing is left to send, picks the relayer.
 * `capabilities` is the wallet's EIP-5792 answer.
 */
const buildSignatureOnlyRelayedScenario = async (
  onRouteUpdate: (route: RouteExtended) => void,
  capabilities: Record<string, unknown>
): Promise<Scenario> => {
  const permitSingle = buildTypedData({
    primaryType: 'PermitSingle',
    domain: {
      name: 'Permit2',
      chainId: CHAIN_ID,
      verifyingContract: CANONICAL_PERMIT2,
    },
    message: {
      details: {
        token: FROM_TOKEN_ADDRESS,
        amount: FROM_AMOUNT,
        expiration: futureDeadline(),
        nonce: '0',
      },
      spender: THIRD_PARTY_ROUTER,
      sigDeadline: futureDeadline(),
    },
  })
  const scenario = createScenario({
    step: buildStep({
      typedData: [permitSingle],
      approvalAddress: '',
      skipApproval: true,
      skipPermit: true,
    }),
    onStepTransaction: (step: LiFiStep) => {
      const { transactionRequest: _dropped, ...rest } = step
      return { ...rest, typedData: [permitSingle] }
    },
    capabilities,
    onRouteUpdate,
  })
  await useTheRealRelayedWait()
  return scenario
}

/**
 * The first run of the C2 shape: one signature, one relay request, and the
 * relayed wait polls that task. No transaction and no batch.
 */
const expectSignatureOnlyStepWasRelayed = (
  scenario: Scenario,
  stored: RouteExtended
): void => {
  expect(scenario.events('signTypedData')).toHaveLength(1)
  expect(scenario.events('relayTransaction')).toHaveLength(1)
  expect(scenario.events('sendTransaction')).toEqual([])
  expect(scenario.events('sendCalls')).toEqual([])
  expect(getRelayedTransactionStatus).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ taskId: RELAY_TASK_ID }),
    expect.anything()
  )
  // Fixture guard: the stored step is the C2 shape, so its content does not
  // name the relayer.
  const storedStep = stored.steps[0]
  expect(storedStep.transactionRequest).toBeUndefined()
  expect(storedStep.typedData?.map((entry) => entry.primaryType)).toEqual([
    'PermitSingle',
  ])
  expect(relayedActionOf(stored)).toMatchObject({
    taskId: RELAY_TASK_ID,
    txType: 'relayed',
  })
}

/** The two wallets of a C2 resume: a wallet without and with batching. */
const SIGNATURE_ONLY_WALLETS: {
  wallet: string
  capabilities: Record<string, unknown>
}[] = [
  { wallet: 'a wallet without batching', capabilities: {} },
  {
    wallet: 'a wallet with batching',
    capabilities: { atomic: { status: 'supported' } },
  },
]

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
  // The relayed lane, not the standard or the batched one: a standard receipt
  // wait or a `waitForCallsStatus` would also sign nothing.
  expect(waitForTransactionReceipt).not.toHaveBeenCalled()
  expect(waitForBatchTransactionReceipt).not.toHaveBeenCalled()
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

// A relayed step of the C2 shape is relayed only because prepare saw that
// nothing was left to send. A resume starts at the wait, after prepare, so
// the step content reads as a standard or a batched step. The lane comes from
// the stored `txType` instead: the resume waits for the same relayer task and
// asks the wallet nothing.
describe('EVM relayed wait of a signature-only step (C2 shape)', () => {
  it.each(SIGNATURE_ONLY_WALLETS)(
    'after the 24 hour deadline, "Try again" with $wallet waits for the same task on the relayed lane',
    async ({ capabilities }) => {
      let stored: RouteExtended | undefined
      const scenario = await buildSignatureOnlyRelayedScenario((route) => {
        stored = persist(route)
      }, capabilities)
      relayerAnswersPending()
      const start = Date.now()

      const run = track(scenario.run())
      await vi.advanceTimersByTimeAsync(0)

      vi.setSystemTime(start + DAY_MS - 10_000)
      await vi.advanceTimersByTimeAsync(20_000)

      expect(run).toMatchObject({ settled: true, resolved: false })
      expect(run.error).toMatchObject({ code: LiFiErrorCode.TransactionFailed })
      expectSignatureOnlyStepWasRelayed(scenario, stored!)
      const action = relayedActionOf(stored!)
      expect(action?.status).toBe('FAILED')
      expect(action?.txFinal).toBeUndefined()
      expect(hasOpenTransaction(action)).toBe(true)

      await expectResumeWaitsForTheSameTask(scenario, stored!)
      expect(scenario.events('relayTransaction')).toHaveLength(1)
      expect(scenario.events('signTypedData')).toHaveLength(1)
    }
  )

  it.each(SIGNATURE_ONLY_WALLETS)(
    'after stopRouteExecution, a resume with $wallet waits for the same task on the relayed lane',
    async ({ capabilities }) => {
      let stored: RouteExtended | undefined
      const scenario = await buildSignatureOnlyRelayedScenario((route) => {
        stored = persist(route)
      }, capabilities)
      relayerAnswersPending()

      const run = track(scenario.run())
      await vi.advanceTimersByTimeAsync(12_000)
      expect(relayerCalls()).toBe(3)

      stopRouteExecution(scenario.route())
      await vi.advanceTimersByTimeAsync(0)

      expect(run).toMatchObject({ settled: true, resolved: true })
      expectSignatureOnlyStepWasRelayed(scenario, stored!)
      const action = relayedActionOf(stored!)
      expect(action?.status).toBe('PENDING')
      expect(hasOpenTransaction(action)).toBe(true)

      await expectResumeWaitsForTheSameTask(scenario, stored!)
      expect(scenario.events('relayTransaction')).toHaveLength(1)
      expect(scenario.events('signTypedData')).toHaveLength(1)
    }
  )
})
