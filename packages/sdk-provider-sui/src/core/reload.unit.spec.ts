import { executeRoute, type RouteExtended, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  buildStep,
  createFakeSuiNetwork,
  type FakeSuiNetwork,
  newSecretKey,
  openPage,
  type Page,
  persist,
  signedBy,
  swapActionOf,
} from './reload.mock.js'

// Every `SuiGrpcClient` the provider builds (`callSuiWithRetry`) answers with
// the same fake Core API client as the integrator client, and with the same
// fake `ledgerService`. `callSuiWithRetry` keeps its clients across specs, so
// the getters read the current spec's fakes on every access. The rest of the
// module (`RpcError`, `GrpcStatusCode`, `GrpcTypes`) stays real.
const grpc = vi.hoisted(() => ({
  core: undefined as unknown,
  ledgerService: undefined as unknown,
}))
vi.mock('@mysten/sui/grpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mysten/sui/grpc')>()),
  SuiGrpcClient: class SuiGrpcClient {
    get core(): unknown {
      return grpc.core
    }
    get ledgerService(): unknown {
      return grpc.ledgerService
    }
  },
}))

// A reload is: persist the route as the widget does (JSON round-trip inside
// `updateRouteHook`), build a new page (signer, provider, client), then
// `resumeRoute`.

let network: FakeSuiNetwork
let secretKey: string

beforeEach(() => {
  network = createFakeSuiNetwork()
  grpc.core = network.client.core
  grpc.ledgerService = network.ledgerService
  secretKey = newSecretKey()
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  // A method the fake does not know would turn into an RPC error and hide
  // the real failure behind an "unknown outcome".
  expect(network.unsupported).toEqual([])
  vi.unstubAllGlobals()
})

/** Runs a route to the end; returns what storage held right after the execution. */
const persistedAfterBroadcast = async (page: Page): Promise<RouteExtended> => {
  let afterBroadcast: RouteExtended | undefined
  await executeRoute(
    page.client,
    buildRoute(await buildStep(page.walletAddress)),
    {
      updateRouteHook: (route) => {
        const swap = swapActionOf(route)
        if (!afterBroadcast && swap?.txHash && swap.status !== 'DONE') {
          afterBroadcast = persist(route)
        }
      },
    }
  )
  expect(page.signTransaction.mock.calls.length, 'wallet sign calls').toBe(1)
  expect(afterBroadcast).toBeDefined()
  return afterBroadcast!
}

describe('Sui reload', () => {
  it('waits for the executed transaction without signing or re-quoting', async () => {
    const afterBroadcast = await persistedAfterBroadcast(
      openPage(network, secretKey)
    )
    const digest = swapActionOf(afterBroadcast)?.txHash

    network.clearRecords()
    const reloaded = openPage(network, secretKey)
    reloaded.signTransaction.mockClear()
    const resumed = await resumeRoute(reloaded.client, afterBroadcast, {
      updateRouteHook: () => {},
    })

    expect(
      reloaded.signTransaction.mock.calls.length,
      'wallet sign calls'
    ).toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    // A resume finds the digest, so nothing is executed.
    expect(network.executed).toEqual([])
    expect(swapActionOf(resumed)?.txHash).toBe(digest)
    expect(resumed.steps[0].execution?.status).toBe('DONE')
  })

  it('re-executes exactly the stored bytes after a reload between signing and execution', async () => {
    const page = openPage(network, secretKey)
    let latest: RouteExtended | undefined
    let afterSigning: RouteExtended | undefined
    // The page dies when the execution request leaves the SDK: the snapshot
    // is what storage held at that instant, the copy the last
    // `updateRouteHook` call wrote. A write that skips the hook is not in it.
    network.onExecute = () => {
      if (!afterSigning && latest) {
        afterSigning = latest
      }
    }
    await executeRoute(
      page.client,
      buildRoute(await buildStep(page.walletAddress)),
      {
        updateRouteHook: (route) => {
          latest = persist(route)
        },
      }
    )
    expect(afterSigning).toBeDefined()
    const signed = await signedBy(page)
    const stored = swapActionOf(afterSigning!)
    // Bytes and signature are stored before the execution.
    // The JSON field names are the Sui task's choice; the values are not.
    expect(stored?.txHex).toBeDefined()
    expect(stored?.txHash).toBeUndefined()
    expect(Object.values(JSON.parse(stored!.txHex!)).flat()).toEqual(
      expect.arrayContaining([signed.bytes, signed.signatures[0]])
    )

    // Nothing reached a node.
    network.onExecute = undefined
    network.forgetChain()
    network.clearRecords()
    const reloaded = openPage(network, secretKey)
    reloaded.signTransaction.mockClear()
    const resumed = await resumeRoute(reloaded.client, afterSigning!, {
      updateRouteHook: () => {},
    })

    expect(
      reloaded.signTransaction.mock.calls.length,
      'wallet sign calls'
    ).toBe(0)
    expect(network.stepTransactionRequests).toBe(0)
    expect(network.executed.length).toBeGreaterThan(0)
    for (const executed of network.executed) {
      expect(executed).toEqual(signed)
    }
    expect(resumed.steps[0].execution?.status).toBe('DONE')
  })

  it('resumes an open transaction in the background without pausing or signing', async () => {
    // The widget's Activities page resumes with `executeInBackground: true`,
    // so every interaction gate pauses. An open transaction needs no user
    // interaction, so the resume must run to the end.
    const afterBroadcast = await persistedAfterBroadcast(
      openPage(network, secretKey)
    )

    network.clearRecords()
    const reloaded = openPage(network, secretKey)
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
    expect(network.executed).toEqual([])
    expect(resumed.steps[0].execution?.status).toBe('DONE')
    expect(
      resumed.steps[0].execution?.actions.map((action) => action.status)
    ).not.toContain('ACTION_REQUIRED')
  })
})

describe('Sui "Try again" loop exit', () => {
  it('signs exactly once after a final failure', async () => {
    const page = openPage(network, secretKey)
    let latest: RouteExtended | undefined
    const updateRouteHook = (route: RouteExtended): void => {
      latest = persist(route)
    }
    // Executed and failed: a final outcome.
    network.failNext = { $kind: 'MoveAbort', message: 'MoveAbort in command 0' }
    await expect(
      executeRoute(
        page.client,
        buildRoute(await buildStep(page.walletAddress)),
        { updateRouteHook }
      )
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
    const page = openPage(network, secretKey)
    let latest: RouteExtended | undefined
    const updateRouteHook = (route: RouteExtended): void => {
      latest = persist(route)
    }
    // The transaction lands; the status API then fails: an unknown outcome.
    network.statusMode = 'no-receiving'
    await expect(
      executeRoute(
        page.client,
        buildRoute(await buildStep(page.walletAddress)),
        { updateRouteHook }
      )
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
