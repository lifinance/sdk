import {
  type ExecutionAction,
  hasOpenTransaction,
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  type RouteExtended,
  type StatusManager,
  stopRouteExecution,
} from '@lifi/sdk'
import { createClient, custom, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
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
vi.mock('../../actions/waitForBatchTransactionReceipt.js')

import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import {
  buildStep,
  buildTransactionRequest,
  createScenario,
  type Scenario,
} from './harness.mock.js'

// A single-call batch rejected in MetaMask. MetaMask returns the bundle id
// before the user decides, and removes the bundle on a reject. A bundle the
// wallet reported in the same wait and then no longer knows never left the
// wallet: the step fails as a rejection, and "Try again" signs anew. A bundle
// that is unknown from the first answer may still land: the action keeps
// its bundle id, and "Try again" waits for it again.

const POLL_MS = 1_000

/** Longer than a poll and viem's 4 retries of a failed request (about 3 s). */
const SETTLE_MS = 10_000

/** The hash of the one call of an approved bundle. */
const RECEIPT_HASH: Hex = `0x${'e5'.repeat(32)}`

type BundleState = 'pending' | 'approved' | 'rejected'

/**
 * MetaMask's EIP-5792 answers for a single call: `wallet_getCallsStatus`
 * answers 100 while the prompt is open and 200 with the receipt after the
 * approval. A rejected bundle is removed, so the wallet fails with 5730
 * "No matching bundle found". One wallet serves every page of a test.
 */
interface MetaMask {
  /** Bundle ids in the order `wallet_sendCalls` returned them. */
  sent: Hex[]
  /** The user's decision in the prompt of a bundle. */
  decide(id: Hex, state: Exclude<BundleState, 'pending'>): void
  /** The answers for a bundle, 100, 200 or 5730, with repeats collapsed. */
  answers(id: Hex): number[]
  /** How many times the wallet was asked for a bundle, retries included. */
  requests(id: Hex): number
  sendCalls(): Hex
  request(args: { method: string; params?: unknown }): Promise<unknown>
}

const createMetaMask = (): MetaMask => {
  const bundles = new Map<Hex, BundleState>()
  const answers = new Map<Hex, number[]>()
  const requests = new Map<Hex, number>()
  const sent: Hex[] = []
  const answer = (id: Hex, code: number): void => {
    requests.set(id, (requests.get(id) ?? 0) + 1)
    const codes = answers.get(id) ?? []
    if (codes.at(-1) !== code) {
      codes.push(code)
    }
    answers.set(id, codes)
  }
  return {
    sent,
    decide: (id, state) => {
      bundles.set(id, state)
    },
    answers: (id) => answers.get(id) ?? [],
    requests: (id) => requests.get(id) ?? 0,
    sendCalls: () => {
      const id: Hex = `0x${(sent.length + 1).toString(16).padStart(64, 'b')}`
      sent.push(id)
      bundles.set(id, 'pending')
      return id
    },
    request: async ({ method, params }) => {
      if (method !== 'wallet_getCallsStatus') {
        throw new Error(`${method} is not part of this fake.`)
      }
      const [id] = params as [Hex]
      const state = bundles.get(id)
      if (state === undefined || state === 'rejected') {
        answer(id, 5730)
        throw Object.assign(new Error('No matching bundle found'), {
          code: 5730,
        })
      }
      if (state === 'pending') {
        answer(id, 100)
        return {
          version: '2.0.0',
          id,
          chainId: '0x89',
          atomic: true,
          status: 100,
        }
      }
      answer(id, 200)
      return {
        version: '2.0.0',
        id,
        chainId: '0x89',
        atomic: true,
        status: 200,
        receipts: [
          {
            logs: [],
            status: '0x1',
            blockHash: `0x${'0b'.repeat(32)}`,
            blockNumber: '0x10',
            gasUsed: '0x5208',
            transactionHash: RECEIPT_HASH,
          },
        ],
      }
    },
  }
}

/** Widget persistence: what `updateRouteHook` wrote to storage. */
const persist = (route: RouteExtended): RouteExtended =>
  JSON.parse(JSON.stringify(route))

const swapOf = (route: RouteExtended): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')

interface Page {
  scenario: Scenario
  /** Every route the hook stored, in order. */
  snapshots: RouteExtended[]
  /** What storage holds now. */
  stored(): RouteExtended
  /** Closes the page: its wallet client fails every later request. */
  close(): void
}

/**
 * One page: an ERC-20 swap with enough allowance on a wallet with batching,
 * so the bundle holds one call. The batched wait runs for real, down to
 * viem's `waitForCallsStatus` and its RPC error mapping, on a viem client of
 * this page. A new page gets a new client: viem shares a poll only between
 * waits on the same client.
 */
const openPage = async (metamask: MetaMask): Promise<Page> => {
  const snapshots: RouteExtended[] = []
  let closed = false
  const scenario = createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 10n ** 24n,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: (step: LiFiStep) => {
      const { typedData: _typedData, ...rest } = step
      return { ...rest, transactionRequest: buildTransactionRequest() }
    },
    onSendCalls: async () => ({ id: metamask.sendCalls() }),
    onRouteUpdate: (route) => {
      snapshots.push(persist(route))
    },
  })
  const walletClient = createClient({
    transport: custom(
      {
        request: async (args: { method: string; params?: unknown }) => {
          if (closed) {
            throw new Error('The page is closed.')
          }
          return metamask.request(args)
        },
      },
      { retryCount: 0 }
    ),
    pollingInterval: POLL_MS,
  })
  const actual = await vi.importActual<
    typeof import('../../actions/waitForBatchTransactionReceipt.js')
  >('../../actions/waitForBatchTransactionReceipt.js')
  vi.mocked(waitForBatchTransactionReceipt).mockImplementation(
    (_client, ...args) =>
      actual.waitForBatchTransactionReceipt(walletClient, ...args)
  )
  return {
    scenario,
    snapshots,
    stored: () => snapshots.at(-1)!,
    close: () => {
      closed = true
    },
  }
}

interface Outcome {
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
 * "Try again" with what storage holds: it signs exactly one new bundle, the
 * user approves it, and the route completes.
 */
const expectTryAgainSignsOnceAndCompletes = async (
  metamask: MetaMask,
  page: Page
): Promise<void> => {
  const from = page.scenario.timeline.length
  const sentBefore = metamask.sent.length

  const tryAgain = track(page.scenario.resume(page.stored()))
  await vi.advanceTimersByTimeAsync(0)

  expect(page.scenario.events('sendCalls', from)).toHaveLength(1)
  expect(metamask.sent).toHaveLength(sentBefore + 1)
  const bundle = metamask.sent.at(-1)!
  metamask.decide(bundle, 'approved')
  await vi.advanceTimersByTimeAsync(SETTLE_MS)

  expect(tryAgain).toMatchObject({ settled: true, resolved: true })
  expect(metamask.answers(bundle)).toEqual([100, 200])
  expect(page.scenario.events('sendCalls', from)).toHaveLength(1)
  expect(page.stored().steps[0].execution?.status).toBe('DONE')
  expect(swapOf(page.stored())).toMatchObject({
    taskId: bundle,
    txHash: RECEIPT_HASH,
  })
}

/** A run of the first page up to the first answer for its bundle (100). */
const runUntilPending = async (
  metamask: MetaMask,
  page: Page
): Promise<{ run: Outcome; bundle: Hex }> => {
  const run = track(page.scenario.run())
  await vi.advanceTimersByTimeAsync(0)
  const [batch] = page.scenario.events('sendCalls')
  // Fixture guard: a single-call batch on the batched lane.
  expect(batch.calls).toHaveLength(1)
  const bundle = metamask.sent[0]
  expect(swapOf(page.stored())).toMatchObject({
    status: 'PENDING',
    taskId: bundle,
    txType: 'batched',
  })
  expect(metamask.answers(bundle)).toEqual([100])
  return { run, bundle }
}

/**
 * The first page sends the bundle, and the page reloads while the prompt is
 * open. Returns what storage held at the reload. The closed page fails its
 * next request; it then settles, so it holds no execution of the route.
 */
const sendAndReload = async (
  metamask: MetaMask
): Promise<{ stored: RouteExtended; bundle: Hex }> => {
  const first = await openPage(metamask)
  const { run, bundle } = await runUntilPending(metamask, first)
  const stored = first.stored()
  first.close()
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  expect(run).toMatchObject({ settled: true, resolved: false })
  return { stored, bundle }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EVM batched wait: a bundle rejected in the wallet', () => {
  it('fails the run with SignatureRejected, and "Try again" signs once', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask)
    const { run, bundle } = await runUntilPending(metamask, page)

    metamask.decide(bundle, 'rejected')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: false })
    expect(run.error).toMatchObject({ code: LiFiErrorCode.SignatureRejected })
    expect(metamask.answers(bundle)).toEqual([100, 5730])
    // Stored as a rejection before sending: no bundle id, no `txFinal`.
    const swap = swapOf(page.stored())
    expect(swap).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(swap?.taskId).toBeUndefined()
    expect(swap?.txFinal).toBeUndefined()
    expect(hasOpenTransaction(swap)).toBe(false)

    await expectTryAgainSignsOnceAndCompletes(metamask, page)
  })

  it('after a reload while the prompt is open: the bundle is pending, then rejected, and "Try again" signs once', async () => {
    const metamask = createMetaMask()
    const { stored, bundle } = await sendAndReload(metamask)

    const page = await openPage(metamask)
    const resumed = track(page.scenario.resume(stored))
    await vi.advanceTimersByTimeAsync(0)
    expect(page.scenario.events('sendCalls')).toEqual([])
    metamask.decide(bundle, 'rejected')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(resumed).toMatchObject({ settled: true, resolved: false })
    expect(resumed.error).toMatchObject({
      code: LiFiErrorCode.SignatureRejected,
    })
    expect(metamask.answers(bundle)).toEqual([100, 5730])
    const swap = swapOf(page.stored())
    expect(swap?.taskId).toBeUndefined()
    expect(hasOpenTransaction(swap)).toBe(false)

    await expectTryAgainSignsOnceAndCompletes(metamask, page)
  })

  // The wallet has no record of the bundle from the first answer: it may be
  // another wallet, or the bundle may have been sent. The SDK cannot tell,
  // so it never signs again.
  it('after a reload after the reject: fails with CallBundleNotFound, keeps the bundle id and signs nothing on "Try again"', async () => {
    const metamask = createMetaMask()
    const { stored, bundle } = await sendAndReload(metamask)
    metamask.decide(bundle, 'rejected')

    const page = await openPage(metamask)
    for (const route of [stored, undefined]) {
      const from = page.scenario.timeline.length
      const resumed = track(page.scenario.resume(route ?? page.stored()))
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(resumed).toMatchObject({ settled: true, resolved: false })
      expect(resumed.error).toMatchObject({ code: 1028 })
      expect(page.scenario.events('sendCalls', from)).toEqual([])
      expect(page.scenario.events('getStepTransaction', from)).toEqual([])
      const swap = swapOf(page.stored())
      expect(swap).toMatchObject({
        status: 'FAILED',
        taskId: bundle,
        txType: 'batched',
        error: { code: LiFiErrorCode.CallBundleNotFound },
      })
      expect(swap?.txFinal).toBeUndefined()
      expect(hasOpenTransaction(swap)).toBe(true)
    }
    expect(metamask.sent).toEqual([bundle])
    expect(metamask.answers(bundle)).toEqual([100, 5730])
  })

  it('completes an approved bundle as before', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask)
    const { run, bundle } = await runUntilPending(metamask, page)

    metamask.decide(bundle, 'approved')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: true })
    expect(metamask.answers(bundle)).toEqual([100, 200])
    expect(metamask.sent).toEqual([bundle])
    expect(page.stored().steps[0].execution?.status).toBe('DONE')
    expect(swapOf(page.stored())).toMatchObject({
      taskId: bundle,
      txHash: RECEIPT_HASH,
    })
  })
})

describe('EVM batched wait: a bundle rejected after stopRouteExecution', () => {
  // The batched wait has no abort signal, so the stopped run keeps waiting.
  // Its write after the reject reaches storage through the hook it kept.
  it('stores the cleared action of the stopped run, and "Try again" signs once', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask)
    const { run, bundle } = await runUntilPending(metamask, page)

    stopRouteExecution(page.scenario.route())
    metamask.decide(bundle, 'rejected')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: false })
    expect(run.error).toMatchObject({ code: LiFiErrorCode.SignatureRejected })
    const swap = swapOf(page.stored())
    expect(swap?.taskId).toBeUndefined()
    expect(hasOpenTransaction(swap)).toBe(false)

    await expectTryAgainSignsOnceAndCompletes(metamask, page)
  })

  // The resume on the same page waits on the same client and bundle id, so
  // viem joins it to the poll of the stopped run. Only the stopped run's
  // wait sees the answers, so only it can prove the drop. Its cleared action
  // must not reach the newer execution, which still holds the bundle id.
  it('leaves the newer execution alone, which fails with CallBundleNotFound and never signs', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask)
    const { run, bundle } = await runUntilPending(metamask, page)

    stopRouteExecution(page.scenario.route())
    const storedSince = page.snapshots.length
    const resumeFrom = page.scenario.timeline.length
    const requestsAtStop = metamask.requests(bundle)
    const resumed = track(page.scenario.resume(page.stored()))
    await vi.advanceTimersByTimeAsync(0)
    // The resume asked the wallet nothing: it joined the running poll.
    expect(metamask.requests(bundle)).toBe(requestsAtStop)
    metamask.decide(bundle, 'rejected')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: false })
    expect(run.error).toMatchObject({ code: LiFiErrorCode.SignatureRejected })
    expect(resumed).toMatchObject({ settled: true, resolved: false })
    expect(resumed.error).toMatchObject({
      code: LiFiErrorCode.CallBundleNotFound,
    })
    expect(page.scenario.events('sendCalls', resumeFrom)).toEqual([])
    // No stored route since the stop lost the bundle id.
    expect(
      page.snapshots.slice(storedSince).map((route) => swapOf(route)?.taskId)
    ).toEqual(Array(page.snapshots.length - storedSince).fill(bundle))
    const swap = swapOf(page.stored())
    expect(swap).toMatchObject({
      status: 'FAILED',
      taskId: bundle,
      error: { code: LiFiErrorCode.CallBundleNotFound },
    })
    expect(hasOpenTransaction(swap)).toBe(true)
    expect(metamask.sent).toEqual([bundle])
  })
})
