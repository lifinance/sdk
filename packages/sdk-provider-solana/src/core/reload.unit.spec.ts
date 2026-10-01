import { executeRoute, type RouteExtended, resumeRoute } from '@lifi/sdk'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { generateTestKeypair } from '../utils/KeypairWallet.unit.helpers.js'
import {
  buildRoute,
  buildStep,
  createFakeNetwork,
  type FakeNetwork,
  openPage,
  type Page,
  persist,
  signatureOf,
  swapActionOf,
} from './reload.mock.js'

// Spec 2026-09-30-resume-without-resign-design.md, section 6 "Central reload
// test" and "Loop exit". A reload is: persist the route as the widget does
// (JSON round-trip inside `updateRouteHook`), build a new page (wallet,
// provider, client), then `resumeRoute`.

let secretKey: string
let network: FakeNetwork

beforeAll(async () => {
  secretKey = (await generateTestKeypair()).secretKey
})

beforeEach(() => {
  network = createFakeNetwork()
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  // A JSON-RPC method the fake does not know would turn into an RPC error and
  // hide the real failure behind an "unknown outcome".
  expect(network.unsupported).toEqual([])
  vi.unstubAllGlobals()
})

/** Starts a new count of wallet sign calls on every page. */
const clearSignCalls = (...pages: Page[]): void => {
  for (const page of pages) {
    page.signTransaction.mockClear()
  }
}

/** Wallet sign calls on all pages since `clearSignCalls`. */
const signCalls = (...pages: Page[]): number =>
  pages.reduce(
    (calls, page) => calls + page.signTransaction.mock.calls.length,
    0
  )

/** Runs a route to the end; returns what storage held right after the broadcast. */
const persistedAfterBroadcast = async (page: Page): Promise<RouteExtended> => {
  let afterBroadcast: RouteExtended | undefined
  await executeRoute(page.client, buildRoute(buildStep(page.walletAddress)), {
    updateRouteHook: (route) => {
      const swap = swapActionOf(route)
      if (!afterBroadcast && swap?.txHash && swap.status !== 'DONE') {
        afterBroadcast = persist(route)
      }
    },
  })
  expect(page.signTransaction.mock.calls.length, 'wallet sign calls').toBe(1)
  expect(afterBroadcast).toBeDefined()
  return afterBroadcast!
}

describe('Solana reload', () => {
  it('waits for the broadcast transaction without signing or re-quoting', async () => {
    const first = await openPage(secretKey)
    const afterBroadcast = await persistedAfterBroadcast(first)
    const broadcastHash = swapActionOf(afterBroadcast)?.txHash

    network.clearRecords()
    const reloaded = await openPage(secretKey)
    clearSignCalls(first, reloaded)
    const resumed = await resumeRoute(reloaded.client, afterBroadcast, {
      updateRouteHook: () => {},
    })

    expect(signCalls(first, reloaded), 'wallet sign calls').toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    // Spec 4.4.5 step 2: the lookup finds the signature, so nothing is sent.
    expect(network.sent).toEqual([])
    expect(swapActionOf(resumed)?.txHash).toBe(broadcastHash)
    expect(resumed.steps[0].execution?.status).toBe('DONE')
  })

  it('resends exactly the stored bytes after a reload between signing and broadcast', async () => {
    const page = await openPage(secretKey)
    let latest: RouteExtended | undefined
    let afterSigning: RouteExtended | undefined
    let firstSent: string | undefined
    // The page dies when the first send leaves the SDK: the snapshot is what
    // storage held at that instant, the copy the last `updateRouteHook` call
    // wrote. A write that skips the hook is not in it.
    network.onSend = (wire) => {
      if (!afterSigning && latest) {
        afterSigning = latest
        firstSent = wire
      }
    }
    await executeRoute(page.client, buildRoute(buildStep(page.walletAddress)), {
      updateRouteHook: (route) => {
        latest = persist(route)
      },
    })
    expect(afterSigning).toBeDefined()
    const stored = swapActionOf(afterSigning!)
    // Spec 4.4.1: `txHex` is written before the first send, `txHash` on the
    // first accepted send.
    expect(stored?.txHex).toBe(firstSent)
    expect(stored?.txHash).toBeUndefined()

    // Nothing reached a node.
    network.onSend = undefined
    network.forgetChain()
    network.clearRecords()
    const reloaded = await openPage(secretKey)
    clearSignCalls(page, reloaded)
    const resumed = await resumeRoute(reloaded.client, afterSigning!, {
      updateRouteHook: () => {},
    })

    expect(signCalls(page, reloaded), 'wallet sign calls').toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(network.sent.length).toBeGreaterThan(0)
    expect(new Set(network.sent)).toEqual(new Set([stored!.txHex]))
    // Spec 4.4.5 step 3: the resend skips simulation.
    expect(network.methods).not.toContain('simulateTransaction')
    expect(swapActionOf(resumed)?.txHash).toBe(signatureOf(stored!.txHex!))
    expect(resumed.steps[0].execution?.status).toBe('DONE')
  })

  it('resumes an open transaction in the background without pausing or signing', async () => {
    // The widget's Activities page resumes with `executeInBackground: true`,
    // so every interaction gate pauses. An open transaction needs no user
    // interaction (spec 4.7), so the resume must run to the end.
    const first = await openPage(secretKey)
    const afterBroadcast = await persistedAfterBroadcast(first)

    network.clearRecords()
    const reloaded = await openPage(secretKey)
    clearSignCalls(first, reloaded)
    const resumed = await resumeRoute(reloaded.client, afterBroadcast, {
      updateRouteHook: () => {},
      executeInBackground: true,
    })

    expect(signCalls(first, reloaded), 'wallet sign calls').toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(resumed.steps[0].execution?.status).toBe('DONE')
    expect(
      resumed.steps[0].execution?.actions.map((action) => action.status)
    ).not.toContain('ACTION_REQUIRED')
  })
})

describe('Solana "Try again" loop exit', () => {
  it('signs exactly once after a final failure', async () => {
    const page = await openPage(secretKey)
    let latest: RouteExtended | undefined
    const updateRouteHook = (route: RouteExtended): void => {
      latest = persist(route)
    }
    // Included with an error: a final outcome (spec 4.3, Solana).
    network.failNext = { InstructionError: [0, { Custom: 1 }] }
    await expect(
      executeRoute(page.client, buildRoute(buildStep(page.walletAddress)), {
        updateRouteHook,
      })
    ).rejects.toThrow()
    const failed = latest!
    expect(swapActionOf(failed)).toMatchObject({
      status: 'FAILED',
      txFinal: true,
    })

    network.clearRecords()
    clearSignCalls(page)
    const retried = await resumeRoute(page.client, failed, { updateRouteHook })

    expect(signCalls(page), 'wallet sign calls').toBe(1)
    expect(network.stepTransactionRequests).toBe(1)
    expect(retried.steps[0].execution?.status).toBe('DONE')
  })

  it('does not sign after an unknown failure', async () => {
    const page = await openPage(secretKey)
    let latest: RouteExtended | undefined
    const updateRouteHook = (route: RouteExtended): void => {
      latest = persist(route)
    }
    // The transaction lands; the status API then fails: an unknown outcome.
    network.statusMode = 'no-receiving'
    await expect(
      executeRoute(page.client, buildRoute(buildStep(page.walletAddress)), {
        updateRouteHook,
      })
    ).rejects.toThrow()
    const failed = latest!
    const swap = swapActionOf(failed)
    expect(swap?.status).toBe('FAILED')
    expect(swap?.txHash).toBeDefined()
    expect(swap?.txFinal).toBeUndefined()

    network.statusMode = 'done'
    network.clearRecords()
    clearSignCalls(page)
    const retried = await resumeRoute(page.client, failed, { updateRouteHook })

    expect(signCalls(page), 'wallet sign calls').toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(swapActionOf(retried)?.txHash).toBe(swap?.txHash)
    expect(retried.steps[0].execution?.status).toBe('DONE')
  })
})
