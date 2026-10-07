import { executeRoute, type RouteExtended, resumeRoute } from '@lifi/sdk'
import type { SignedTransaction } from '@tronweb3/tronwallet-abstract-adapter'
import { providers } from 'tronweb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  buildStep,
  createFakeTronNetwork,
  type FakeTronNetwork,
  openPage,
  type Page,
  persist,
  swapActionOf,
} from './reload.mock.js'

// A reload is: persist the route as the widget does (JSON round-trip inside
// `updateRouteHook`), build a new page (wallet, provider, client), then
// `resumeRoute`.

let network: FakeTronNetwork

/** The fields that make a Tron transaction the same signed transaction. */
const identity = (transaction: SignedTransaction) => ({
  txID: transaction.txID,
  raw_data_hex: transaction.raw_data_hex,
  signature: transaction.signature,
})

beforeEach(() => {
  network = createFakeTronNetwork()
  vi.spyOn(providers.HttpProvider.prototype, 'request').mockImplementation(
    (url: string, payload?: Record<string, unknown>) =>
      network.request(url, payload)
  )
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  // An endpoint the fake does not know would turn into an RPC error and hide
  // the real failure behind an "unknown outcome".
  expect(network.unsupported).toEqual([])
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Runs a route to the end; returns what storage held right after the broadcast. */
const persistedAfterBroadcast = async (page: Page): Promise<RouteExtended> => {
  let afterBroadcast: RouteExtended | undefined
  await executeRoute(page.client, buildRoute(buildStep()), {
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

describe('Tron reload', () => {
  it('waits for the broadcast transaction without signing or re-quoting', async () => {
    const page = openPage()
    const afterBroadcast = await persistedAfterBroadcast(page)
    const signed = identity(await page.signTransaction.mock.results[0].value)
    const broadcastHash = swapActionOf(afterBroadcast)?.txHash

    network.clearRecords()
    const reloaded = openPage()
    reloaded.signTransaction.mockClear()
    const resumed = await resumeRoute(reloaded.client, afterBroadcast, {
      updateRouteHook: () => {},
    })

    expect(
      reloaded.signTransaction.mock.calls.length,
      'wallet sign calls'
    ).toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    // A resume may resend; it must be the same transaction.
    for (const broadcast of network.broadcasts) {
      expect(identity(broadcast)).toEqual(signed)
    }
    expect(swapActionOf(resumed)?.txHash).toBe(broadcastHash)
    expect(resumed.steps[0].execution?.status).toBe('DONE')
  })

  it('resends exactly the stored transaction after a reload between signing and broadcast', async () => {
    const page = openPage()
    let latest: RouteExtended | undefined
    let afterSigning: RouteExtended | undefined
    // The page dies when the first broadcast leaves the SDK: the snapshot is
    // what storage held at that instant, the copy the last `updateRouteHook`
    // call wrote. A write that skips the hook is not in it.
    network.onBroadcast = () => {
      if (!afterSigning && latest) {
        afterSigning = latest
      }
    }
    await executeRoute(page.client, buildRoute(buildStep()), {
      updateRouteHook: (route) => {
        latest = persist(route)
      },
    })
    expect(afterSigning).toBeDefined()
    const signed = identity(await page.signTransaction.mock.results[0].value)
    const stored = swapActionOf(afterSigning!)
    // The signed transaction JSON is stored before the broadcast.
    expect(stored?.txHex).toBeDefined()
    expect(stored?.txHash).toBeUndefined()
    expect(identity(JSON.parse(stored!.txHex!))).toEqual(signed)

    // Nothing reached a node.
    network.onBroadcast = undefined
    network.forgetChain()
    network.clearRecords()
    const reloaded = openPage()
    reloaded.signTransaction.mockClear()
    const resumed = await resumeRoute(reloaded.client, afterSigning!, {
      updateRouteHook: () => {},
    })

    expect(
      reloaded.signTransaction.mock.calls.length,
      'wallet sign calls'
    ).toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(network.broadcasts.length).toBeGreaterThan(0)
    for (const broadcast of network.broadcasts) {
      expect(identity(broadcast)).toEqual(signed)
    }
    expect(swapActionOf(resumed)?.txHash).toBe(signed.txID)
    expect(resumed.steps[0].execution?.status).toBe('DONE')
  })

  it('resumes an open transaction in the background without pausing or signing', async () => {
    // The widget's Activities page resumes with `executeInBackground: true`,
    // so every interaction gate pauses. An open transaction needs no user
    // interaction, so the resume must run to the end.
    const afterBroadcast = await persistedAfterBroadcast(openPage())

    network.clearRecords()
    const reloaded = openPage()
    reloaded.signTransaction.mockClear()
    const resumed = await resumeRoute(reloaded.client, afterBroadcast, {
      updateRouteHook: () => {},
      executeInBackground: true,
    })

    expect(
      reloaded.signTransaction.mock.calls.length,
      'wallet sign calls'
    ).toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(resumed.steps[0].execution?.status).toBe('DONE')
    expect(
      resumed.steps[0].execution?.actions.map((action) => action.status)
    ).not.toContain('ACTION_REQUIRED')
  })
})

describe('Tron "Try again" loop exit', () => {
  it('signs exactly once after a final failure', async () => {
    const page = openPage()
    let latest: RouteExtended | undefined
    const updateRouteHook = (route: RouteExtended): void => {
      latest = persist(route)
    }
    // Included and reverted: a final outcome.
    network.failNext = 'REVERT'
    await expect(
      executeRoute(page.client, buildRoute(buildStep()), { updateRouteHook })
    ).rejects.toThrow()
    const failed = latest!
    expect(swapActionOf(failed)).toMatchObject({
      status: 'FAILED',
      txFinal: true,
    })

    network.clearRecords()
    page.signTransaction.mockClear()
    const retried = await resumeRoute(page.client, failed, { updateRouteHook })

    expect(page.signTransaction.mock.calls.length, 'wallet sign calls').toBe(1)
    expect(network.stepTransactionRequests).toBe(1)
    expect(retried.steps[0].execution?.status).toBe('DONE')
  })

  it('does not sign after an unknown failure', async () => {
    const page = openPage()
    let latest: RouteExtended | undefined
    const updateRouteHook = (route: RouteExtended): void => {
      latest = persist(route)
    }
    // The transaction lands; the status API then fails: an unknown outcome.
    network.statusMode = 'no-receiving'
    await expect(
      executeRoute(page.client, buildRoute(buildStep()), { updateRouteHook })
    ).rejects.toThrow()
    const failed = latest!
    const swap = swapActionOf(failed)
    expect(swap?.status).toBe('FAILED')
    expect(swap?.txHash).toBeDefined()
    expect(swap?.txFinal).toBeUndefined()

    network.statusMode = 'done'
    network.clearRecords()
    page.signTransaction.mockClear()
    const retried = await resumeRoute(page.client, failed, { updateRouteHook })

    expect(page.signTransaction.mock.calls.length, 'wallet sign calls').toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(swapActionOf(retried)?.txHash).toBe(swap?.txHash)
    expect(retried.steps[0].execution?.status).toBe('DONE')
  })
})
