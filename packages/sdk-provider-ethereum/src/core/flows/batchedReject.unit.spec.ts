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
import { type Chain, createClient, custom, type Hex } from 'viem'
import { sendCalls } from 'viem/actions'
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
  CHAIN_ID,
  createScenario,
  FROM_ADDRESS,
  type Scenario,
} from './harness.mock.js'

// A single-call batch rejected in MetaMask. MetaMask returns the bundle id
// before the user decides, and removes the bundle on a reject. The SDK
// treats a bundle that the wallet reported in the same wait and then no
// longer knows as never sent: the step fails with a final rejection, and
// "Try again" signs anew. A bundle that is unknown from the first answer
// may still land: the action keeps its bundle id, and "Try again" waits for
// it again.
//
// A batch of two or more calls (EIP-7702) is different. MetaMask returns its
// id only after the user approved it and the wallet sent it, and a reject
// fails `wallet_sendCalls` with 4001. A multi-call bundle that the wallet
// then no longer knows was sent, so it may still land.

const POLL_MS = 1_000

/** Longer than a poll and viem's 4 retries of a failed request (about 3 s). */
const SETTLE_MS = 10_000

/** The hash of the one call of an approved bundle. */
const RECEIPT_HASH: Hex = `0x${'e5'.repeat(32)}`

/**
 * `pending` while the prompt is open, `sent` after the approval until the
 * bundle is in a block, `approved` in a block, `rejected` after a reject.
 */
type BundleState = 'pending' | 'sent' | 'approved' | 'rejected'

/**
 * MetaMask's EIP-5792 answers. `wallet_sendCalls` returns the id of a
 * single call at once, and the id of two or more calls only after the
 * approval; a reject of those fails with 4001. `wallet_getCallsStatus`
 * answers 100 while the prompt is open or the bundle is not in a block,
 * and 200 with the receipt in a block. A rejected or deleted bundle is
 * removed, so the wallet fails with 5730 "No matching bundle found". One
 * wallet serves every page of a test.
 */
interface MetaMask {
  /** Bundle ids in the order their prompts opened. */
  prompts: Hex[]
  /** Bundle ids in the order `wallet_sendCalls` returned them. */
  sent: Hex[]
  /**
   * The user's decision in the prompt of a bundle. `sent` approves it and
   * keeps it out of a block; `approved` puts it in a block at once.
   */
  decide(id: Hex, state: Exclude<BundleState, 'pending'>): void
  /**
   * Settings > Developer Tools > "Delete activity and nonce data": the
   * wallet removes every bundle, also a sent one.
   */
  deleteActivity(): void
  /** The answers for a bundle, 100, 200 or 5730, with repeats collapsed. */
  answers(id: Hex): number[]
  /** How many times the wallet was asked for a bundle, retries included. */
  requests(id: Hex): number
  request(args: { method: string; params?: unknown }): Promise<unknown>
}

const createMetaMask = (): MetaMask => {
  const bundles = new Map<Hex, BundleState>()
  const decisions = new Map<Hex, () => void>()
  const answers = new Map<Hex, number[]>()
  const requests = new Map<Hex, number>()
  const prompts: Hex[] = []
  const sent: Hex[] = []
  const answer = (id: Hex, code: number): void => {
    requests.set(id, (requests.get(id) ?? 0) + 1)
    const codes = answers.get(id) ?? []
    if (codes.at(-1) !== code) {
      codes.push(code)
    }
    answers.set(id, codes)
  }
  const sendCalls = async (callCount: number): Promise<{ id: Hex }> => {
    const id: Hex = `0x${(prompts.length + 1).toString(16).padStart(64, 'b')}`
    prompts.push(id)
    bundles.set(id, 'pending')
    if (callCount > 1) {
      await new Promise<void>((resolve) => {
        decisions.set(id, resolve)
      })
      if (bundles.get(id) === 'rejected') {
        throw Object.assign(new Error('User rejected the request.'), {
          code: 4001,
        })
      }
    }
    sent.push(id)
    return { id }
  }
  return {
    prompts,
    sent,
    decide: (id, state) => {
      bundles.set(id, state)
      decisions.get(id)?.()
      decisions.delete(id)
    },
    deleteActivity: () => {
      bundles.clear()
    },
    answers: (id) => answers.get(id) ?? [],
    requests: (id) => requests.get(id) ?? 0,
    request: async ({ method, params }) => {
      if (method === 'wallet_sendCalls') {
        const [{ calls }] = params as [{ calls: unknown[] }]
        return sendCalls(calls.length)
      }
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
      if (state === 'pending' || state === 'sent') {
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
 * One page: an ERC-20 swap on a wallet with batching. With enough allowance
 * the bundle holds one call; with `calls` 2 the allowance is zero, and the
 * bundle holds the approval and the swap. `wallet_sendCalls` and the batched
 * wait run for real, down to viem's `sendCalls`, `waitForCallsStatus` and
 * their RPC error mapping, on a viem client of this page. A new page gets a
 * new client: viem shares a poll only between waits on the same client.
 */
const openPage = async (
  metamask: MetaMask,
  calls: 1 | 2 = 1
): Promise<Page> => {
  const snapshots: RouteExtended[] = []
  let closed = false
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
  const scenario = createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: calls === 1 ? 10n ** 24n : 0n,
    capabilities: { atomic: { status: 'supported' } },
    onStepTransaction: (step: LiFiStep) => {
      const { typedData: _typedData, ...rest } = step
      return { ...rest, transactionRequest: buildTransactionRequest() }
    },
    onSendCalls: async (request) => {
      const { id } = await sendCalls(walletClient, {
        account: FROM_ADDRESS,
        chain: { id: CHAIN_ID } as Chain,
        calls: request.calls as Parameters<typeof sendCalls>[1]['calls'],
      })
      return { id: id as Hex }
    },
    onRouteUpdate: (route) => {
      snapshots.push(persist(route))
    },
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
 * "Try again" with what storage holds: it signs exactly one new bundle of
 * `calls` calls, the user approves it, and the route completes.
 */
const expectTryAgainSignsOnceAndCompletes = async (
  metamask: MetaMask,
  page: Page,
  calls: 1 | 2 = 1
): Promise<void> => {
  const from = page.scenario.timeline.length
  const promptsBefore = metamask.prompts.length

  const tryAgain = track(page.scenario.resume(page.stored()))
  await vi.advanceTimersByTimeAsync(0)

  const batches = page.scenario.events('sendCalls', from)
  expect(batches).toHaveLength(1)
  expect(batches[0].calls).toHaveLength(calls)
  expect(metamask.prompts).toHaveLength(promptsBefore + 1)
  const bundle = metamask.prompts.at(-1)!
  metamask.decide(bundle, 'approved')
  await vi.advanceTimersByTimeAsync(SETTLE_MS)

  expect(tryAgain).toMatchObject({ settled: true, resolved: true })
  expect(metamask.sent.at(-1)).toBe(bundle)
  // The id of one call comes back while the prompt is open (100).
  expect(metamask.answers(bundle)).toEqual(calls === 1 ? [100, 200] : [200])
  expect(page.scenario.events('sendCalls', from)).toHaveLength(1)
  expect(page.stored().steps[0].execution?.status).toBe('DONE')
  expect(swapOf(page.stored())).toMatchObject({
    taskId: bundle,
    callCount: calls,
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
    // Stored as a final rejection: the bundle id stays, with `txFinal`.
    const swap = swapOf(page.stored())
    expect(swap).toMatchObject({
      status: 'FAILED',
      taskId: bundle,
      txFinal: true,
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(hasOpenTransaction(swap)).toBe(false)

    await expectTryAgainSignsOnceAndCompletes(metamask, page)
  })

  it('after a reload while the prompt is open: the bundle is pending, then rejected, and "Try again" signs once', async () => {
    const metamask = createMetaMask()
    const { stored, bundle } = await sendAndReload(metamask)
    // The new page has no calls in its context: the wait reads this count.
    expect(swapOf(stored)).toMatchObject({ taskId: bundle, callCount: 1 })

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
    expect(swap).toMatchObject({ taskId: bundle, txFinal: true })
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

describe('EVM batched wait: a bundle of two calls (an approval and a swap)', () => {
  /**
   * A run of the first page up to the open prompt of its bundle. The wallet
   * has returned no id yet, so the SDK stored none.
   */
  const runUntilPrompt = async (
    metamask: MetaMask,
    page: Page
  ): Promise<{ run: Outcome; bundle: Hex }> => {
    const run = track(page.scenario.run())
    await vi.advanceTimersByTimeAsync(0)
    const [batch] = page.scenario.events('sendCalls')
    // Fixture guard: the approval and the swap in one batch.
    expect(batch.calls).toHaveLength(2)
    expect(metamask.prompts).toHaveLength(1)
    expect(metamask.sent).toEqual([])
    const [bundle] = metamask.prompts
    expect(swapOf(page.stored())?.taskId).toBeUndefined()
    return { run, bundle }
  }

  it('fails a reject with SignatureRejected and stores no bundle id, and "Try again" signs once', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask, 2)
    const { run, bundle } = await runUntilPrompt(metamask, page)

    metamask.decide(bundle, 'rejected')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: false })
    expect(run.error).toMatchObject({ code: LiFiErrorCode.SignatureRejected })
    expect(metamask.sent).toEqual([])
    // The SDK never had the id, so it never asked for the bundle.
    expect(metamask.requests(bundle)).toBe(0)
    const swap = swapOf(page.stored())
    expect(swap).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(swap?.taskId).toBeUndefined()
    expect(swap?.callCount).toBeUndefined()
    expect(hasOpenTransaction(swap)).toBe(false)

    await expectTryAgainSignsOnceAndCompletes(metamask, page, 2)
  })

  // The wallet sent the bundle before it returned the id. When it then has
  // no record of it (e.g. "Delete activity and nonce data"), the bundle can
  // still land: the SDK keeps the bundle id and never signs again.
  it('fails with CallBundleNotFound when the wallet deletes a sent bundle, keeps the bundle id and signs nothing on "Try again"', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask, 2)
    const { run, bundle } = await runUntilPrompt(metamask, page)

    metamask.decide(bundle, 'sent')
    await vi.advanceTimersByTimeAsync(0)
    expect(metamask.sent).toEqual([bundle])
    expect(metamask.answers(bundle)).toEqual([100])
    expect(swapOf(page.stored())).toMatchObject({
      status: 'PENDING',
      taskId: bundle,
      txType: 'batched',
      callCount: 2,
    })

    // Well within 10 minutes of signing: only the call count keeps the
    // bundle from a drop.
    metamask.deleteActivity()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: false })
    expect(run.error).toMatchObject({
      code: LiFiErrorCode.CallBundleNotFound,
    })
    expect(metamask.answers(bundle)).toEqual([100, 5730])
    const expectBundleKept = (): void => {
      const swap = swapOf(page.stored())
      expect(swap).toMatchObject({
        status: 'FAILED',
        taskId: bundle,
        txType: 'batched',
        callCount: 2,
        error: { code: LiFiErrorCode.CallBundleNotFound },
      })
      expect(swap?.txFinal).toBeUndefined()
      expect(hasOpenTransaction(swap)).toBe(true)
    }
    expectBundleKept()

    const from = page.scenario.timeline.length
    const tryAgain = track(page.scenario.resume(page.stored()))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(tryAgain).toMatchObject({ settled: true, resolved: false })
    expect(tryAgain.error).toMatchObject({
      code: LiFiErrorCode.CallBundleNotFound,
    })
    expect(page.scenario.events('sendCalls', from)).toEqual([])
    expect(page.scenario.events('getStepTransaction', from)).toEqual([])
    expectBundleKept()
    expect(metamask.prompts).toEqual([bundle])
  })
})

describe('EVM batched wait: a bundle rejected after stopRouteExecution', () => {
  // The batched wait has no abort signal, so the stopped run keeps waiting.
  // Its write after the reject reaches storage through the hook it kept.
  it('stores the final rejection of the stopped run, and "Try again" signs once', async () => {
    const metamask = createMetaMask()
    const page = await openPage(metamask)
    const { run, bundle } = await runUntilPending(metamask, page)

    stopRouteExecution(page.scenario.route())
    metamask.decide(bundle, 'rejected')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run).toMatchObject({ settled: true, resolved: false })
    expect(run.error).toMatchObject({ code: LiFiErrorCode.SignatureRejected })
    const swap = swapOf(page.stored())
    expect(swap).toMatchObject({
      status: 'FAILED',
      taskId: bundle,
      txFinal: true,
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(hasOpenTransaction(swap)).toBe(false)

    await expectTryAgainSignsOnceAndCompletes(metamask, page)
  })

  // The resume on the same page waits on the same client and bundle id, so
  // viem joins it to the poll of the stopped run. Only the stopped run's
  // wait sees the answers, so only it can prove the drop. Its final
  // rejection must not reach the newer execution, which still holds the
  // bundle id.
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
    // No stored route since the stop lost the bundle id or closed it.
    const since = page.snapshots.slice(storedSince).map(swapOf)
    expect(since.map((swap) => swap?.taskId)).toEqual(
      Array(since.length).fill(bundle)
    )
    expect(since.map((swap) => hasOpenTransaction(swap))).toEqual(
      Array(since.length).fill(true)
    )
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
