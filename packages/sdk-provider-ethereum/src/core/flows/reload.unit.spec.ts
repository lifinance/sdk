import {
  type ExecutionAction,
  getActiveRoute,
  hasOpenTransaction,
  LiFiErrorCode,
  type RouteExtended,
  relayTransaction,
  stopRouteExecution,
  TransactionError,
} from '@lifi/sdk'
import type { Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  buildPermitWitnessTypedData,
  buildStep,
  buildTransactionRequest,
  createScenario,
  type Scenario,
  type ScenarioOptions,
} from './harness.mock.js'

// A resume waits for the stored transaction instead of signing again, and
// "Try again" signs anew only after a final failure.

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

const TENDERLY_URL =
  /^https:\/\/api\.tenderly\.co\/api\/v1\/public-contract\/\d+\/tx\/0x[0-9a-f]+$/

/**
 * The error parser asks Tenderly about every reverted transaction
 * (`fetchTxErrorDetails`). This stub answers it inside the process, as
 * `network.mock.ts` does; any other request throws, so no request leaves
 * the process.
 */
const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input)
  if (!TENDERLY_URL.test(url)) {
    throw new Error(`Unexpected fetch in the reload spec: ${url}`)
  }
  // Not an out-of-gas revert, so the parser keeps `TransactionFailed`.
  return Response.json({ error_message: 'execution reverted' })
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
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
    // no user interaction. The harness stubs the terminal status watcher, so
    // the step stays PENDING instead of DONE; what matters is that it reached
    // the receipt wait and no action asks for the user.
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
    // receipt once the Ethereum task marks that site final.
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
    // The parser looked the revert up on the stub, not on the real API.
    expect(fetchStub).toHaveBeenCalledWith(
      `https://api.tenderly.co/api/v1/public-contract/${failed.steps[0].action.fromChainId}/tx/${swapActionOf(failed)?.txHash}`
    )

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

// A task still running at `stopRouteExecution` writes its hash afterwards.
describe('EVM transaction written after stopRouteExecution', () => {
  const SIGNATURE_A: Hex = `0x${'aa'.repeat(64)}1b`
  const SIGNATURE_B: Hex = `0x${'bb'.repeat(64)}1b`
  const TASK_A: Hex = `0x${'a1'.repeat(32)}`
  const TASK_B: Hex = `0x${'b1'.repeat(32)}`

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

  // The relayed lane: the SDK, not the wallet, sends the signed message, so
  // it can still refuse after the wallet returns.
  it('stop during a relayed prompt, resume, approve both prompts: the newer execution does not relay', async () => {
    const prompts = [Promise.withResolvers<Hex>(), Promise.withResolvers<Hex>()]
    let stored: RouteExtended | undefined
    const scenario = createScenario({
      step: buildStep({ typedData: [buildPermitWitnessTypedData()] }),
      allowance: 0n,
      onRouteUpdate: (route) => {
        stored = persist(route)
      },
      onSignTypedData: (_request, callIndex) => prompts[callIndex].promise,
    })
    // A task id per relay, so the action shows whose relay it holds. The
    // harness implementation still records each relay.
    const harnessRelay = vi.mocked(relayTransaction).getMockImplementation()!
    vi.mocked(relayTransaction).mockImplementation(async (...args) => ({
      ...(await harnessRelay(...args)),
      taskId:
        scenario.events('relayTransaction').length === 1 ? TASK_A : TASK_B,
    }))

    const running = scenario.run()
    await vi.waitFor(() =>
      expect(scenario.events('signTypedData')).toHaveLength(1)
    )
    stopRouteExecution(scenario.route())
    const resumed = scenario.resume(stored!).then(
      () => undefined,
      (error: unknown) => error
    )
    // Both prompts are open before either answers.
    await vi.waitFor(() =>
      expect(scenario.events('signTypedData')).toHaveLength(2)
    )

    prompts[0].resolve(SIGNATURE_A)
    // The stopped run relays, and its late write merges the task id into the
    // newer execution while the newer prompt is still open.
    await running
    expect(swapActionOf(getActiveRoute(stored!.id)!)?.taskId).toBe(TASK_A)

    prompts[1].resolve(SIGNATURE_B)
    const outcome = await resumed

    expect(
      scenario
        .events('relayTransaction')
        .map((event) => event.typedData.map((entry) => entry.signature))
    ).toEqual([[SIGNATURE_A]])
    expect(outcome).toMatchObject({ code: LiFiErrorCode.TransactionConflict })
    const swap = swapActionOf(stored!)
    expect(swap?.taskId).toBe(TASK_A)
    expect(hasOpenTransaction(swap)).toBe(true)
  })
})
