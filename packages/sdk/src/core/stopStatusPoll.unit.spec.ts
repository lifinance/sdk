import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecuteStepRetryError, UnknownError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type {
  ExecutionAction,
  RouteExtended,
  SDKClient,
  StepExecutorOptions,
} from '../types/core.js'
import type {
  StepExecutorBaseContext,
  StepExecutorContext,
  TaskResult,
} from '../types/execution.js'
import { BaseStepExecutionTask } from './BaseStepExecutionTask.js'
import { BaseStepExecutor } from './BaseStepExecutor.js'
import {
  executeRoute,
  getActiveRoute,
  resumeRoute,
  stopRouteExecution,
} from './execution.js'
import { buildRouteObject, buildStepObject } from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { TaskPipeline } from './TaskPipeline.js'
import {
  TRANSACTION_HASH_OBSERVERS,
  waitForTransactionStatus,
} from './tasks/helpers/waitForTransactionStatus.js'
import { WaitForTransactionStatusTask } from './tasks/WaitForTransactionStatusTask.js'
import { hasOpenTransaction } from './transactionState.js'

// The `/status` poll of a route that `stopRouteExecution` stopped (memory-leak
// findings, core L2). `fetch` is stubbed; the poll runs on fake timers.

const INTERVAL = 5_000
const HOUR = 3_600_000

let counter = 0
const nextId = (): string => `status-poll-${counter++}`

const notFound = (): Response =>
  new Response(JSON.stringify({ status: 'NOT_FOUND' }))
const failed = (): Response =>
  new Response(JSON.stringify({ status: 'FAILED', substatus: 'REFUNDED' }))
const pending = (txHash: string) => (): Response =>
  new Response(
    JSON.stringify({
      status: 'PENDING',
      substatus: 'WAIT_DESTINATION_TRANSACTION',
      substatusMessage: 'Waiting for the destination chain.',
      sending: { txHash, chainId: 137 },
      receiving: { chainId: 137 },
      lifiExplorerLink: `https://scan.li.fi/tx/${txHash}`,
    })
  )
const done = (txHash: string) => (): Response =>
  new Response(
    JSON.stringify({
      status: 'DONE',
      substatus: 'COMPLETED',
      sending: { txHash, chainId: 137 },
      receiving: { txHash, chainId: 137 },
    })
  )

/** The answer of the status API to every request. */
let answer: () => Response = notFound
const fetchMock = vi.fn(
  async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    answer()
)
const statusRequests = (): number =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/status?'))
    .length

/** The first attempt of a step ends in `ExecuteStepRetryError` when set. */
let retryFirstAttempt = false
const RETRY_MESSAGE = 'Retry the step.'

/** The wallet: each call signs and sends a transaction, and gives its hash. */
const wallet = vi.fn<() => Promise<string>>()

/**
 * Signs only while the step has no open transaction, as the pipeline
 * selector of every provider does: a resume waits for the transaction.
 */
class SignTask extends BaseStepExecutionTask {
  override async shouldRun({
    step,
    statusManager,
  }: StepExecutorContext): Promise<boolean> {
    return !hasOpenTransaction(statusManager.findAction(step, 'SWAP'))
  }

  async run({
    step,
    statusManager,
    retryParams,
  }: StepExecutorContext): Promise<TaskResult> {
    if (retryFirstAttempt && !retryParams) {
      throw new Error(RETRY_MESSAGE)
    }
    statusManager.initializeAction({
      step,
      type: 'SWAP',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })
    const txHash = await wallet()
    statusManager.updateAction(step, 'SWAP', 'PENDING', { txHash })
    return { status: 'COMPLETED' }
  }
}

/**
 * Waits like `WaitForTransactionStatusTask`, but lets every error reach the
 * catch block of the step executor, which writes FAILED.
 */
class RethrowingWaitTask extends BaseStepExecutionTask {
  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, signal } = context
    const txHash = statusManager.findAction(step, 'SWAP')!.txHash!
    await waitForTransactionStatus(
      client,
      statusManager,
      txHash,
      step,
      'SWAP',
      INTERVAL,
      signal
    )
    return { status: 'COMPLETED' }
  }
}

type WaitTask = () => BaseStepExecutionTask

class PollExecutor extends BaseStepExecutor {
  private readonly waitTask: WaitTask

  constructor(options: StepExecutorOptions, waitTask: WaitTask) {
    super(options)
    this.waitTask = waitTask
  }

  override createContext = async (
    baseContext: StepExecutorBaseContext
  ): Promise<StepExecutorContext> => ({
    ...baseContext,
    pollingIntervalMs: INTERVAL,
  })

  override createPipeline = (): TaskPipeline =>
    new TaskPipeline([new SignTask(), this.waitTask()])

  override parseErrors = async (
    error: Error
  ): Promise<SDKError | ExecuteStepRetryError> =>
    error.message === RETRY_MESSAGE
      ? new ExecuteStepRetryError(RETRY_MESSAGE, { retried: true }, error)
      : new SDKError(new UnknownError(error.message, error))
}

const chain = {
  id: 137,
  name: 'Polygon',
  metamask: { blockExplorerUrls: ['https://polygonscan.com/'] },
}

const buildClient = (
  waitTask: WaitTask = () => new WaitForTransactionStatusTask('SWAP')
): SDKClient =>
  ({
    config: { apiUrl: 'https://li.quest/v1', integrator: 'status-poll-spec' },
    getChainById: async () => chain,
    providers: [
      {
        isAddress: (): boolean => true,
        getStepExecutor: async (options: StepExecutorOptions) =>
          new PollExecutor(options, waitTask),
      },
    ],
  }) as unknown as SDKClient

/** A same-chain swap that has not started. */
const buildRoute = (): RouteExtended => ({
  ...buildRouteObject({ step: buildStepObject({ includingExecution: false }) }),
  id: nextId(),
})

/** Records what the integrator stores: a JSON copy per hook call. */
const storeRoute = () => {
  const stored: RouteExtended[] = []
  const updateRouteHook = vi.fn((route: RouteExtended): void => {
    stored.push(JSON.parse(JSON.stringify(route)))
  })
  return { stored, updateRouteHook, last: () => stored.at(-1)! }
}

const swapOf = (route: RouteExtended): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')

type Outcome = {
  settled: boolean
  value?: RouteExtended
  error?: unknown
}

const observe = (promise: Promise<RouteExtended>): Outcome => {
  const outcome: Outcome = { settled: false }
  promise.then(
    (value) => {
      outcome.settled = true
      outcome.value = value
    },
    (error: unknown) => {
      outcome.settled = true
      outcome.error = error
    }
  )
  return outcome
}

const advance = (ms: number): Promise<unknown> =>
  vi.advanceTimersByTimeAsync(ms)

const startedRoutes: RouteExtended[] = []

/** Runs `route` until it polls; the poll asked `/status` four times. */
const startPolling = async (
  client: SDKClient,
  route: RouteExtended,
  updateRouteHook: (route: RouteExtended) => void
): Promise<Outcome> => {
  startedRoutes.push(route)
  const run = observe(executeRoute(client, route, { updateRouteHook }))
  await advance(3 * INTERVAL)
  return run
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  wallet.mockReset()
  answer = notFound
  retryFirstAttempt = false
})

afterEach(() => {
  for (const route of startedRoutes.splice(0)) {
    stopRouteExecution(route)
  }
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the /status poll of a stopped route', () => {
  it('(a) ends after the stop and frees the records of the route', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    const route = buildRoute()

    const run = await startPolling(buildClient(), route, vi.fn())
    expect(statusRequests()).toBe(4)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeDefined()

    stopRouteExecution(route)
    const atStop = statusRequests()
    await advance(HOUR)

    expect(statusRequests() - atStop).toBeLessThanOrEqual(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
    // The stopped run ends like a stopped step: the promise resolves with
    // the route as it was at the stop.
    expect(run.settled).toBe(true)
    expect(run.error).toBeUndefined()
    expect(swapOf(run.value!)).toMatchObject({ status: 'PENDING', txHash })
    expect(executionState.state[route.id]).toBeUndefined()
    expect(executionState.starts[route.id]).toBeUndefined()
    expect(executionState.ended[route.id]).toBeUndefined()
    expect(executionState.inFlight[route.id]).toBeUndefined()
  })

  it('(a) ends after the stop also when the step runs again after ExecuteStepRetryError', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    retryFirstAttempt = true
    const route = buildRoute()

    const run = await startPolling(buildClient(), route, vi.fn())
    expect(statusRequests()).toBe(4)

    stopRouteExecution(route)
    const atStop = statusRequests()
    await advance(HOUR)

    expect(statusRequests() - atStop).toBeLessThanOrEqual(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
    expect(run.settled).toBe(true)
    expect(run.error).toBeUndefined()
  })

  it('(b) leaves the stored route as it was at the stop', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    const route = buildRoute()
    const { updateRouteHook, last } = storeRoute()

    const run = await startPolling(buildClient(), route, updateRouteHook)
    const callsAtStop = updateRouteHook.mock.calls.length
    const storedAtStop = last()
    expect(swapOf(storedAtStop)).toMatchObject({ status: 'PENDING', txHash })

    stopRouteExecution(route)
    await advance(HOUR)

    expect(run.settled).toBe(true)
    expect(updateRouteHook).toHaveBeenCalledTimes(callsAtStop)
    expect(last()).toEqual(storedAtStop)
    expect(last().steps[0].execution?.status).toBe('PENDING')
    expect(swapOf(last())?.txFinal).toBeUndefined()
  })

  it('(b) leaves the stored route unchanged also when the abort reaches the catch block of the step', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    const route = buildRoute()
    const { updateRouteHook, last } = storeRoute()

    const run = await startPolling(
      buildClient(() => new RethrowingWaitTask()),
      route,
      updateRouteHook
    )
    const callsAtStop = updateRouteHook.mock.calls.length
    const storedAtStop = last()
    expect(swapOf(storedAtStop)).toMatchObject({ status: 'PENDING', txHash })

    stopRouteExecution(route)
    await advance(HOUR)

    // The executor writes FAILED without `txFinal`; the stopped status
    // manager does not pass it on.
    expect(run.settled).toBe(true)
    expect((run.error as SDKError).cause.cause).toMatchObject({
      name: 'AbortError',
    })
    expect(updateRouteHook).toHaveBeenCalledTimes(callsAtStop)
    expect(last()).toEqual(storedAtStop)
  })

  it('(c) resumes the stored route without a signature and polls the hash again', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    const route = buildRoute()
    const { updateRouteHook, last } = storeRoute()
    const client = buildClient()

    await startPolling(client, route, updateRouteHook)
    stopRouteExecution(route)
    await advance(HOUR)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()

    const resumedStore = storeRoute()
    answer = pending(txHash)
    const atResume = statusRequests()
    const resumed = observe(
      resumeRoute(client, last(), {
        updateRouteHook: resumedStore.updateRouteHook,
      })
    )
    startedRoutes.push(route)
    // Shorter than the interval: only a new poll asks at once.
    await advance(INTERVAL / 5)

    expect(statusRequests()).toBe(atResume + 1)
    // The new poll writes through the status manager of the resumed run.
    expect(swapOf(resumedStore.last())).toMatchObject({
      status: 'PENDING',
      txHash,
      substatus: 'WAIT_DESTINATION_TRANSACTION',
    })

    answer = done(txHash)
    await advance(INTERVAL)

    expect(resumed.settled).toBe(true)
    expect(resumed.value?.steps[0].execution?.status).toBe('DONE')
    expect(wallet).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
  })

  it('(d) keeps polling for another route that waits for the same hash, and ends when both stopped', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    const client = buildClient()
    const routeA = buildRoute()
    const routeB = buildRoute()

    const runA = await startPolling(client, routeA, vi.fn())
    const runB = await startPolling(client, routeB, vi.fn())
    // One shared poll: one request per interval.
    expect(statusRequests()).toBe(7)

    stopRouteExecution(routeA)
    const atStopA = statusRequests()
    await advance(4 * INTERVAL)

    expect(runA.settled).toBe(true)
    expect(statusRequests() - atStopA).toBe(4)
    expect(runB.settled).toBe(false)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeDefined()

    stopRouteExecution(routeB)
    const atStopB = statusRequests()
    await advance(HOUR)

    expect(runB.settled).toBe(true)
    expect(statusRequests() - atStopB).toBeLessThanOrEqual(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
  })

  it('(d) completes the other route that waits for the same hash', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    const client = buildClient()
    const routeA = buildRoute()
    const routeB = buildRoute()

    const runA = await startPolling(client, routeA, vi.fn())
    const runB = await startPolling(client, routeB, vi.fn())
    stopRouteExecution(routeA)
    await advance(INTERVAL)
    expect(runA.settled).toBe(true)

    answer = done(txHash)
    await advance(INTERVAL)

    expect(runB.settled).toBe(true)
    expect(runB.value?.steps[0].execution?.status).toBe('DONE')
    expect(swapOf(runA.value!)?.status).toBe('PENDING')
    expect(vi.getTimerCount()).toBe(0)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
  })
})

describe('the /status poll of a running route', () => {
  // Characterization: a FAILED answer does not end the wait of a running
  // execution.
  it('(e) keeps polling on FAILED while the route runs', async () => {
    const txHash = `0x${nextId()}`
    wallet.mockResolvedValue(txHash)
    answer = failed
    const route = buildRoute()
    const { updateRouteHook, last } = storeRoute()

    const run = await startPolling(buildClient(), route, updateRouteHook)
    await advance(HOUR)

    expect(statusRequests()).toBe(4 + HOUR / INTERVAL)
    expect(run.settled).toBe(false)
    expect(getActiveRoute(route.id)).toBeDefined()
    expect(last().steps[0].execution?.status).toBe('PENDING')
    expect(swapOf(last())).toMatchObject({ status: 'PENDING', txHash })
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeDefined()
  })
})
