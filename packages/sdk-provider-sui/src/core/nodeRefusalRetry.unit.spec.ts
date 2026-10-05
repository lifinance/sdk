import {
  ChainType,
  executeRoute,
  LiFiErrorCode,
  type RouteExtended,
  resumeRoute,
  type SDKError,
} from '@lifi/sdk'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import {
  buildRoute,
  buildStep,
  createFakeSuiNetwork,
  type ExecutedTransaction,
  type FakeSuiNetwork,
  newSecretKey,
  openPage,
  type Page,
  persist,
  swapActionOf,
} from './reload.mock.js'

// Every `SuiGrpcClient` the provider builds (`callSuiWithRetry`) answers with
// the same fake Core API client as the integrator client, and with the same
// fake `ledgerService` (as in `reload.unit.spec.ts`). The getters also note
// which entries of `network.methods` went through a `SuiGrpcClient`, so a
// spec can tell the SDK's own gRPC clients from the integrator client. The
// rest of the module (`RpcError`, `GrpcStatusCode`, `GrpcTypes`) stays real.
const grpc = vi.hoisted(() => ({
  core: undefined as unknown,
  ledgerService: undefined as unknown,
  /** `network.methods` of the current spec. */
  methods: [] as string[],
  /** Positions in `methods` of the calls made through a `SuiGrpcClient`. */
  viaGrpc: new Set<number>(),
}))
vi.mock('@mysten/sui/grpc', async (importOriginal) => {
  // The fake records the name of a call in `methods` when the call starts.
  const throughGrpc = (target: unknown): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          const member = Reflect.get(target as object, property)
          if (typeof member !== 'function') {
            return member
          }
          return (...args: unknown[]) => {
            grpc.viaGrpc.add(grpc.methods.length)
            return member(...args)
          }
        },
      }
    )
  return {
    ...(await importOriginal<typeof import('@mysten/sui/grpc')>()),
    SuiGrpcClient: class SuiGrpcClient {
      get core(): unknown {
        return throughGrpc(grpc.core)
      }
      get ledgerService(): unknown {
        return throughGrpc(grpc.ledgerService)
      }
    },
  }
})

// Spec 2026-09-30-resume-without-resign-design.md: a node refuses the first
// execution of the signed bytes, and the user clicks "Try again" (the widget
// resumes the route it stored). Sections 4.2.8 (resend age cap, dropped),
// 4.2.9, 4.3 (Sui row), 4.6 (resume mode), 4.7, 5 and 8.

/**
 * A node error without a final marker, as an RPC error reaches the provider.
 * The reload specs model no node refusal, so this is a plain `Error`.
 */
const NODE_REFUSAL_MESSAGE =
  'Transaction rejected by the validators (non-retriable).'

/** The local clock when the wallet signs. */
const SIGNING_TIME = Date.parse('2026-10-05T12:00:00.000Z')
const MINUTE = 60_000

let network: FakeSuiNetwork
let secretKey: string
/** Every execution request that reached the node, also a refused one. */
let requests: ExecutedTransaction[]
/** The node refuses the next execution requests with these errors. */
let refusals: Error[]
/** Path of every LI.FI API request, in order. */
let apiRequests: string[]

beforeEach(() => {
  // Only `Date`: the signing time and the age of the stored bytes.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SIGNING_TIME)
  network = createFakeSuiNetwork()
  grpc.core = network.client.core
  grpc.ledgerService = network.ledgerService
  grpc.methods = network.methods
  grpc.viaGrpc.clear()
  secretKey = newSecretKey()
  requests = []
  refusals = []
  network.onExecute = (request) => {
    requests.push(request)
    const refusal = refusals.shift()
    if (refusal) {
      throw refusal
    }
  }
  apiRequests = []
  vi.stubGlobal(
    'fetch',
    (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      apiRequests.push(new URL(url).pathname)
      return network.fetch(input, init)
    }
  )
})

afterEach(() => {
  // A method the fake does not know would turn into an RPC error and hide
  // the real failure behind an "unknown outcome".
  expect(network.unsupported).toEqual([])
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** `network.methods`, each name prefixed with the client it went through. */
const methodsByClient = (): string[] =>
  network.methods.map(
    (name, index) => `${grpc.viaGrpc.has(index) ? 'grpc' : 'client'}.${name}`
  )

/** Clears the call records of the fakes; the chain state stays. */
const clearRecords = (): void => {
  network.clearRecords()
  grpc.viaGrpc.clear()
  requests.length = 0
  apiRequests.length = 0
}

/** The bytes and the signature of a page's `index`-th wallet call. */
const signedByCall = async (
  page: Page,
  index: number
): Promise<ExecutedTransaction> => {
  const [bytes] = page.signTransaction.mock.calls[index] as [Uint8Array]
  const { signature } = (await page.signTransaction.mock.results[index]
    .value) as { signature: string }
  return { bytes: toBase64(bytes), signatures: [signature] }
}

const digestOf = (bytes: string): string =>
  TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes))

interface RouteUpdates {
  hook: (route: RouteExtended) => void
  /** A JSON copy of the route at every hook call (what storage holds). */
  snapshots: RouteExtended[]
  /**
   * `${action type}:${status}` each time an action appears or changes its
   * status between two hook calls, in order.
   */
  changes: string[]
}

const recordRouteUpdates = (): RouteUpdates => {
  let previous = new Map<string, string>()
  const updates: RouteUpdates = {
    snapshots: [],
    changes: [],
    hook: (route) => {
      const snapshot = persist(route)
      updates.snapshots.push(snapshot)
      const current = new Map<string, string>()
      for (const action of snapshot.steps[0].execution?.actions ?? []) {
        current.set(action.type, action.status)
        if (previous.get(action.type) !== action.status) {
          updates.changes.push(`${action.type}:${action.status}`)
        }
      }
      previous = current
    },
  }
  return updates
}

interface RefusedRun {
  error: SDKError
  updates: RouteUpdates
  /** What storage held at the end of the run. */
  stored: RouteExtended
  /** The bytes and the signature the wallet produced. */
  signed: ExecutedTransaction
}

/** A new swap whose first execution request the node refuses. */
const runRefusedSwap = async (page: Page): Promise<RefusedRun> => {
  refusals.push(new Error(NODE_REFUSAL_MESSAGE))
  const updates = recordRouteUpdates()
  const error = (await executeRoute(
    page.client,
    buildRoute(await buildStep(page.walletAddress)),
    { updateRouteHook: updates.hook }
  ).catch((e: unknown) => e)) as SDKError
  const stored = updates.snapshots.at(-1)
  expect(stored).toBeDefined()
  return {
    error,
    updates,
    stored: stored!,
    signed: await signedByCall(page, 0),
  }
}

/** The stored signed transaction of the route's SWAP action, parsed. */
const storedBytesOf = (route: RouteExtended): unknown => {
  const txHex = swapActionOf(route)?.txHex
  return txHex === undefined ? undefined : JSON.parse(txHex)
}

/** The provider's balance read, spied (the balance check calls it). */
const spyOnBalance = (page: Page): Mock =>
  vi.spyOn(page.client.getProvider(ChainType.MVM)!, 'getBalance') as Mock

describe('Sui node refusal of the first execution', () => {
  it('fails without a final marker and keeps the signed bytes', async () => {
    const page = openPage(network, secretKey)

    const { error, updates, stored, signed } = await runRefusedSwap(page)

    expect(error.code).toBe(LiFiErrorCode.InternalError)
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    // The request reached the node, which refused it: nothing landed.
    expect(requests).toEqual([signed])
    expect(network.executed).toEqual([])
    expect(methodsByClient()).toEqual(['client.executeTransaction'])
    expect(network.stepTransactionRequests).toBe(0)
    expect(apiRequests).toEqual([])
    // #507 behaviour: the signed bytes are written with status PENDING
    // before the execution request (spec 4.6 step 2).
    expect(updates.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    // #507 behaviour: the refusal is an RPC error, an unknown outcome
    // (spec 4.3, Sui row). It comes at the first send attempt, not before
    // it, so `txHex` stays (spec 4.2.9), and there is no `txFinal`.
    const execution = stored.steps[0].execution
    expect(execution).toMatchObject({
      status: 'FAILED',
      signedAt: SIGNING_TIME,
      error: { code: LiFiErrorCode.InternalError },
    })
    const action = swapActionOf(stored)
    expect(action).toMatchObject({
      type: 'SWAP',
      status: 'FAILED',
      error: { code: LiFiErrorCode.InternalError },
    })
    expect(storedBytesOf(stored)).toEqual({
      bytes: signed.bytes,
      signature: signed.signatures[0],
    })
    expect(action).not.toHaveProperty('txHash')
    expect(action).not.toHaveProperty('txFinal')
  })
})

describe('Sui "Try again" after a node refusal, within the resend age cap', () => {
  it('re-executes the stored bytes without the wallet, and completes when the node accepts them', async () => {
    const page = openPage(network, secretKey)
    const { stored, signed } = await runRefusedSwap(page)
    const getBalance = spyOnBalance(page)
    clearRecords()

    // One minute after signing: within MAX_RESEND_AGE_MS (2 minutes).
    vi.setSystemTime(SIGNING_TIME + MINUTE)
    const retry = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, stored, {
      updateRouteHook: retry.hook,
    })

    // #507 behaviour: the kept action starts the pipeline at the wait task
    // (spec 4.7 "FAILED, unknown"): no balance check, no quote, no wallet.
    expect(getBalance).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toBe(0)
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    // #507 behaviour: the digest is not found, so the SDK's gRPC clients
    // re-execute exactly the stored bytes, then wait by digest (spec 4.6
    // resume mode).
    expect(methodsByClient()).toEqual([
      'grpc.getTransaction',
      'grpc.executeTransaction',
      'grpc.waitForTransaction',
    ])
    expect(requests).toEqual([signed])
    expect(network.executed).toEqual([signed])
    expect(apiRequests).toEqual(['/v1/status'])
    // #507 behaviour: the swap completes on the quote of the first run.
    expect(retry.changes).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    const digest = digestOf(signed.bytes)
    const execution = resumed.steps[0].execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        txHash: digest,
        txLink: `https://suivision.test/txblock/${digest}`,
      }),
    ])
  })

  it('stays FAILED without a final marker when the node refuses the stored bytes again', async () => {
    const page = openPage(network, secretKey)
    const { stored, signed } = await runRefusedSwap(page)
    const getBalance = spyOnBalance(page)
    clearRecords()

    vi.setSystemTime(SIGNING_TIME + MINUTE)
    refusals.push(new Error(NODE_REFUSAL_MESSAGE))
    const retry = recordRouteUpdates()
    const error = (await resumeRoute(page.client, stored, {
      updateRouteHook: retry.hook,
    }).catch((e: unknown) => e)) as SDKError

    expect(error.code).toBe(LiFiErrorCode.InternalError)
    expect(getBalance).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toBe(0)
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    expect(methodsByClient()).toEqual([
      'grpc.getTransaction',
      'grpc.executeTransaction',
    ])
    expect(requests).toEqual([signed])
    expect(network.executed).toEqual([])
    expect(apiRequests).toEqual([])
    expect(retry.changes).toEqual(['SWAP:PENDING', 'SWAP:FAILED'])
    // #507 behaviour: the second refusal is a plain RPC error, not a
    // definite rejection, so the wait task rethrows it and the outcome stays
    // unknown (spec 4.3, Sui row). The next "Try again" re-checks again
    // instead of signing (spec 5).
    const failed = retry.snapshots.at(-1)!
    const action = swapActionOf(failed)
    expect(action).toMatchObject({
      type: 'SWAP',
      status: 'FAILED',
      error: { code: LiFiErrorCode.InternalError },
    })
    expect(storedBytesOf(failed)).toEqual({
      bytes: signed.bytes,
      signature: signed.signatures[0],
    })
    expect(action).not.toHaveProperty('txHash')
    expect(action).not.toHaveProperty('txFinal')
    expect(failed.steps[0].execution?.signedAt).toBe(SIGNING_TIME)
  })
})

describe('Sui "Try again" after a node refusal, past the resend age cap', () => {
  it('sends nothing, fails final once the chain proves the digest dropped, and the next Try again signs new bytes', async () => {
    const page = openPage(network, secretKey)
    const { stored, signed } = await runRefusedSwap(page)
    const getBalance = spyOnBalance(page)
    clearRecords()

    // 18 minutes after signing: past the latest landing time that the
    // dropped proof needs (2 min age cap + 10 min clock skew + 5 min head
    // margin = 17 min), so the canary search can cover it.
    vi.setSystemTime(SIGNING_TIME + 18 * MINUTE)
    const retry = recordRouteUpdates()
    const error = (await resumeRoute(page.client, stored, {
      updateRouteHook: retry.hook,
    }).catch((e: unknown) => e)) as SDKError

    // #507 behaviour: past the cap the SDK never sends (spec 4.2.8); the
    // batch lookup proves absence, and the status API does not know the
    // digest (spec 4.6 "Dropped"): a final TransactionExpired.
    expect(error.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(getBalance).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toBe(0)
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([])
    expect(network.executed).toEqual([])
    // The canary search reads the tip, a checkpoint behind it and one
    // before the signing time; one batch lookup holds the target digest
    // and both canaries.
    expect(methodsByClient()).toEqual([
      'grpc.getTransaction',
      'grpc.ledgerService.getCheckpoint',
      'grpc.ledgerService.getCheckpoint',
      'grpc.ledgerService.getCheckpoint',
      'grpc.ledgerService.batchGetTransactions',
    ])
    expect(apiRequests).toEqual(['/v1/status'])
    expect(retry.changes).toEqual(['SWAP:PENDING', 'SWAP:FAILED'])
    const failed = retry.snapshots.at(-1)!
    const action = swapActionOf(failed)
    expect(action).toMatchObject({
      type: 'SWAP',
      status: 'FAILED',
      txFinal: true,
      error: { code: LiFiErrorCode.TransactionExpired },
    })
    expect(action).not.toHaveProperty('txHex')
    expect(action).not.toHaveProperty('txHash')

    // #507 behaviour: "Try again" after a final failure signs new bytes
    // exactly once (spec 4.7 "FAILED + txFinal").
    clearRecords()
    const again = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, failed, {
      updateRouteHook: again.hook,
    })

    expect(getBalance).toHaveBeenCalledTimes(1)
    expect(network.stepTransactionRequests).toBe(1)
    expect(page.signTransaction).toHaveBeenCalledTimes(2)
    const renewed = await signedByCall(page, 1)
    expect(renewed.bytes).not.toBe(signed.bytes)
    expect(requests).toEqual([renewed])
    expect(network.executed).toEqual([renewed])
    expect(methodsByClient()).toEqual([
      'client.executeTransaction',
      'grpc.waitForTransaction',
    ])
    expect(apiRequests).toEqual(['/v1/advanced/stepTransaction', '/v1/status'])
    expect(again.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const digest = digestOf(renewed.bytes)
    const execution = resumed.steps[0].execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.signedAt).toBe(SIGNING_TIME + 18 * MINUTE)
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        txHash: digest,
        txLink: `https://suivision.test/txblock/${digest}`,
      }),
    ])
  })

  it('sends nothing and stays FAILED without a final marker before the chain can prove the digest dropped', async () => {
    const page = openPage(network, secretKey)
    const { stored, signed } = await runRefusedSwap(page)
    const getBalance = spyOnBalance(page)
    clearRecords()

    // 5 minutes after signing: past the age cap, but the chain is not yet
    // past the latest landing time (17 minutes). The fake wait by digest
    // gives up after one second of `Date` time, so `Date` follows the real
    // clock from here.
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(SIGNING_TIME + 5 * MINUTE)
    const retry = recordRouteUpdates()
    const error = (await resumeRoute(page.client, stored, {
      updateRouteHook: retry.hook,
    }).catch((e: unknown) => e)) as SDKError

    // #507 behaviour: past the cap the SDK never sends (spec 4.2.8). The
    // tip is not past the latest landing time, so the canary search stops
    // after one checkpoint and there is no dropped proof; the task waits by
    // digest, and the outcome stays unknown (spec 4.6). So "Try again" gives
    // no new signature until about 17 minutes after signing. (The error is
    // the fake's own timeout of the wait, read as an UnknownError.)
    expect(error.code).toBe(LiFiErrorCode.InternalError)
    expect(getBalance).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toBe(0)
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([])
    expect(network.executed).toEqual([])
    expect(methodsByClient()).toEqual([
      'grpc.getTransaction',
      'grpc.ledgerService.getCheckpoint',
      'grpc.waitForTransaction',
    ])
    expect(apiRequests).toEqual([])
    expect(retry.changes).toEqual(['SWAP:PENDING', 'SWAP:FAILED'])
    const failed = retry.snapshots.at(-1)!
    const action = swapActionOf(failed)
    expect(action).toMatchObject({
      type: 'SWAP',
      status: 'FAILED',
      error: { code: LiFiErrorCode.InternalError },
    })
    expect(storedBytesOf(failed)).toEqual({
      bytes: signed.bytes,
      signature: signed.signatures[0],
    })
    expect(action).not.toHaveProperty('txHash')
    expect(action).not.toHaveProperty('txFinal')
  })
})
