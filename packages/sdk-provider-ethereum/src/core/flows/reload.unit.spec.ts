import {
  type ExecutionAction,
  LiFiErrorCode,
  type RouteExtended,
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
  options: {
    onRouteUpdate?: (route: RouteExtended) => void
    executeInBackground?: boolean
  } = {}
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
