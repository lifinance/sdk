import {
  type ExecutionAction,
  getActiveRoute,
  hasOpenTransaction,
  LiFiErrorCode,
  type RouteExtended,
  stopRouteExecution,
  TransactionError,
} from '@lifi/sdk'
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

import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import {
  buildStep,
  buildTransactionRequest,
  createScenario,
  type Scenario,
  type ScenarioOptions,
} from './harness.mock.js'

// Spec 2026-09-30-resume-without-resign-design.md, section 6: the EVM
// regression of the central reload test, and the "Try again" loop exit.

/** Widget persistence: what `updateRouteHook` wrote to storage. */
const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

const swapActionOf = (route: RouteExtended): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')

/**
 * A same-chain swap with a plain transaction and enough allowance. A re-quote
 * answers with a fresh transaction request, as the real endpoint does, so a
 * pipeline that re-signs gets as far as the wallet.
 */
const buildSwapScenario = (
  options: Pick<
    ScenarioOptions,
    | 'onRouteUpdate'
    | 'executeInBackground'
    | 'beforeSendTransaction'
    | 'onStepTransaction'
  > = {}
): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 10n ** 24n,
    onStepTransaction: (step) => ({
      ...step,
      transactionRequest: buildTransactionRequest(),
    }),
    ...options,
  })

/** Runs a swap to the end; returns what storage held right after the send. */
const persistedAfterBroadcast = async (): Promise<RouteExtended> => {
  let afterBroadcast: RouteExtended | undefined
  const first = buildSwapScenario({
    onRouteUpdate: (route) => {
      const swap = swapActionOf(route)
      if (!afterBroadcast && swap?.txHash && swap.status !== 'DONE') {
        afterBroadcast = persist(route)
      }
    },
  })
  await first.run()
  expect(first.events('sendTransaction')).toHaveLength(1)
  expect(afterBroadcast).toBeDefined()
  return afterBroadcast!
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EVM reload (regression)', () => {
  it('waits for the sent transaction without signing or re-quoting', async () => {
    const afterBroadcast = await persistedAfterBroadcast()
    const txHash = swapActionOf(afterBroadcast)?.txHash

    // A new page: new wallet client, provider, client and executor.
    const reloaded = buildSwapScenario()
    // Count only the resume's receipt waits: the first run waited on the
    // same hash.
    vi.mocked(waitForTransactionReceipt).mockClear()
    const resumed = await reloaded.resume(afterBroadcast)

    expect(reloaded.events('sendTransaction')).toEqual([])
    expect(reloaded.events('sendCalls')).toEqual([])
    expect(reloaded.events('signTypedData')).toEqual([])
    expect(reloaded.events('getStepTransaction')).toEqual([])
    expect(vi.mocked(waitForTransactionReceipt)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ txHash })
    )
    expect(swapActionOf(resumed)?.txHash).toBe(txHash)
  })

  it('resumes a sent transaction in the background without pausing or signing', async () => {
    // The widget's Activities page resumes with `executeInBackground: true`,
    // so every interaction gate pauses. Waiting for a sent transaction needs
    // no user interaction (spec 4.7). The harness stubs the terminal status
    // watcher, so the step stays PENDING instead of DONE; what matters is that
    // it reached the receipt wait and no action asks for the user.
    const afterBroadcast = await persistedAfterBroadcast()
    const txHash = swapActionOf(afterBroadcast)?.txHash

    const reloaded = buildSwapScenario({ executeInBackground: true })
    // Count only the resume's receipt waits: the first run waited on the
    // same hash.
    vi.mocked(waitForTransactionReceipt).mockClear()
    const resumed = await reloaded.resume(afterBroadcast)

    expect(reloaded.events('sendTransaction')).toEqual([])
    expect(reloaded.events('signTypedData')).toEqual([])
    expect(reloaded.events('getStepTransaction')).toEqual([])
    expect(vi.mocked(waitForTransactionReceipt)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ txHash })
    )
    expect(resumed.steps[0].execution?.status).toBe('PENDING')
    expect(
      resumed.steps[0].execution?.actions.map((action) => action.status)
    ).not.toContain('ACTION_REQUIRED')
  })
})

describe('EVM "Try again" loop exit', () => {
  it('signs exactly once after a final failure', async () => {
    const scenario = buildSwapScenario()
    // The error the real `waitForTransactionReceipt` throws for a reverted
    // receipt once the Ethereum task marks that site final (spec 4.3).
    vi.mocked(waitForTransactionReceipt).mockRejectedValueOnce(
      new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction was reverted.',
        undefined,
        { final: true }
      )
    )
    await scenario.runExpectingFailure()
    const failed = persist(scenario.route())
    expect(swapActionOf(failed)).toMatchObject({
      status: 'FAILED',
      txFinal: true,
    })

    const retryFrom = scenario.timeline.length
    // Count only the resume's receipt waits: the first run waited on the
    // same hash.
    vi.mocked(waitForTransactionReceipt).mockClear()
    await scenario.resume(failed)

    expect(scenario.events('sendTransaction', retryFrom)).toHaveLength(1)
    expect(scenario.events('getStepTransaction', retryFrom)).toHaveLength(1)
  })

  it('does not sign after an unknown failure', async () => {
    const scenario = buildSwapScenario()
    // An RPC outage while waiting for the receipt: an unknown outcome.
    vi.mocked(waitForTransactionReceipt).mockRejectedValueOnce(
      new Error('HTTP request failed. Status: 503')
    )
    await scenario.runExpectingFailure()
    const failed = persist(scenario.route())
    const swap = swapActionOf(failed)
    expect(swap?.status).toBe('FAILED')
    expect(swap?.txHash).toBeDefined()
    expect(swap?.txFinal).toBeUndefined()

    const retryFrom = scenario.timeline.length
    // Count only the resume's receipt waits: the first run waited on the
    // same hash.
    vi.mocked(waitForTransactionReceipt).mockClear()
    await scenario.resume(failed)

    expect(scenario.events('sendTransaction', retryFrom)).toEqual([])
    expect(scenario.events('signTypedData', retryFrom)).toEqual([])
    expect(scenario.events('getStepTransaction', retryFrom)).toEqual([])
    expect(vi.mocked(waitForTransactionReceipt)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ txHash: swap?.txHash })
    )
  })
})

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.5:
// a task still running at `stopRouteExecution` writes its hash afterwards.
describe('EVM transaction written after stopRouteExecution', () => {
  /** The hash the wallet answered, as the sign task wrote it. */
  const signedHashOf = (scenario: Scenario): string | undefined =>
    scenario
      .events('action')
      .find((event) => event.actionType === 'SWAP' && event.txHash)?.txHash

  it('stop, then reload: the resume waits for the hash and signs nothing', async () => {
    const wallet = Promise.withResolvers<void>()
    // Snapshot at hook time, as the widget's store does: the live route
    // object keeps changing after the hook returned.
    let stored: RouteExtended | undefined
    const first = buildSwapScenario({
      beforeSendTransaction: () => wallet.promise,
      onRouteUpdate: (route) => {
        stored = persist(route)
      },
    })
    const running = first.run()
    await vi.waitFor(() =>
      expect(first.events('sendTransaction')).toHaveLength(1)
    )

    stopRouteExecution(first.route())
    wallet.resolve()
    await running

    // A new page: new wallet client, provider, client and executor.
    const reloaded = buildSwapScenario()
    const resumed = await reloaded.resume(stored!)

    expect(first.events('sendTransaction')).toHaveLength(1)
    expect(reloaded.events('sendTransaction')).toEqual([])
    expect(reloaded.events('getStepTransaction')).toEqual([])
    const signedHash = signedHashOf(first)
    expect(signedHash).toBeDefined()
    // The hook got the hash although the run was stopped.
    expect(swapActionOf(stored!)?.txHash).toBe(signedHash)
    expect(swapActionOf(resumed)?.txHash).toBe(signedHash)
  })

  it('stop, resume at once, late release: the newer execution does not sign', async () => {
    const wallet = Promise.withResolvers<void>()
    let stepTransactionGate: Promise<void> | undefined
    let stored: RouteExtended | undefined
    const scenario = buildSwapScenario({
      onRouteUpdate: (route) => {
        stored = persist(route)
      },
      // Hold only the first run's wallet prompt.
      beforeSendTransaction: (callIndex) =>
        callIndex === 0 ? wallet.promise : Promise.resolve(),
      onStepTransaction: async (step) => {
        await stepTransactionGate
        return { ...step, transactionRequest: buildTransactionRequest() }
      },
    })
    const running = scenario.run()
    await vi.waitFor(() =>
      expect(scenario.events('sendTransaction')).toHaveLength(1)
    )

    stopRouteExecution(scenario.route())
    // Armed only now: the first run also asked for a transaction.
    const stepTransaction = Promise.withResolvers<void>()
    stepTransactionGate = stepTransaction.promise
    const resumeFrom = scenario.timeline.length
    const resumed = scenario.resume(stored!).then(
      () => undefined,
      (error: unknown) => error
    )
    await vi.waitFor(() =>
      expect(scenario.events('getStepTransaction', resumeFrom)).toHaveLength(1)
    )

    wallet.resolve()
    // The stopped run writes its hash, which merges into the newer execution,
    // and then finishes its step. Ending a step without DONE must not stop the
    // newer execution of the same route id.
    await running
    const newerAfterOldRun = getActiveRoute(stored!.id)

    stepTransaction.resolve()
    const outcome = await resumed

    expect(scenario.events('sendTransaction')).toHaveLength(1)
    // The late hash reached the newer execution before its sign task, so
    // the pre-sign guard refused a second signature.
    expect(outcome).toMatchObject({ code: LiFiErrorCode.TransactionConflict })
    const swap = swapActionOf(stored!)
    expect(swap?.txHash).toBe(signedHashOf(scenario))
    expect(hasOpenTransaction(swap)).toBe(true)
    expect(newerAfterOldRun).toBeDefined()
  })
})
