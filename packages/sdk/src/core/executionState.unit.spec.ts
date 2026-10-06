import { describe, expect, it, vi } from 'vitest'
import { ExecuteStepRetryError } from '../errors/errors.js'
import type {
  ExecutionAction,
  InteractionSettings,
  LiFiStepExtended,
  RouteExtended,
  SDKClient,
  StepExecutor,
} from '../types/core.js'
import { executeRoute, resumeRoute, stopRouteExecution } from './execution.js'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { StatusManager } from './StatusManager.js'
import { CLEARED_TRANSACTION_FIELDS } from './transactionState.js'

const RECORDS = ['state', 'starts', 'ended', 'inFlight'] as const

/** How many of `routeIds` each `executionState` record still holds. */
const heldRecords = (routeIds: string[]): Partial<Record<string, number>> => {
  const held: Partial<Record<string, number>> = {}
  for (const name of RECORDS) {
    const count = routeIds.filter((routeId) =>
      Object.hasOwn(executionState[name], routeId)
    ).length
    if (count > 0) {
      held[name] = count
    }
  }
  return held
}

const routeWithId = (id: string): RouteExtended => ({
  ...buildRouteObject({ step: buildStepObject({ includingExecution: true }) }),
  id,
})

const LATE_WRITE = {
  ...CLEARED_TRANSACTION_FIELDS,
  txHash: '0xlate',
  signedAt: SOME_DATE,
}

const swapOf = (route: RouteExtended): ExecutionAction | undefined =>
  route.steps[0].execution?.actions.find((action) => action.type === 'SWAP')

const finishStep = (step: LiFiStepExtended): LiFiStepExtended => {
  step.execution!.status = 'DONE'
  return step
}

/** A client whose provider hands out `executors` in order. */
const clientWith = (...executors: StepExecutor[]): SDKClient =>
  ({
    providers: [
      {
        isAddress: (): boolean => true,
        getStepExecutor: async (): Promise<StepExecutor> => executors.shift()!,
      },
    ],
  }) as unknown as SDKClient

/**
 * A step executor whose step waits until `release`, then ends with `end`. A
 * stop reaches it, and `statusManager` when given, as it reaches a
 * `BaseStepExecutor`.
 */
const heldExecutor = (
  end: (step: LiFiStepExtended) => LiFiStepExtended = (step) => step,
  statusManager?: StatusManager
): { executor: StepExecutor; entered: Promise<void>; release: () => void } => {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const executor: StepExecutor = {
    allowUserInteraction: true,
    allowExecution: true,
    setInteraction: (settings?: InteractionSettings): void => {
      executor.allowExecution = settings?.allowExecution ?? true
      statusManager?.allowUpdates(settings?.allowUpdates ?? true)
    },
    executeStep: async (
      _client: SDKClient,
      step: LiFiStepExtended
    ): Promise<LiFiStepExtended> => {
      entered.resolve()
      await released.promise
      return end(step)
    },
  }
  return {
    executor,
    entered: entered.promise,
    release: () => released.resolve(),
  }
}

describe('executionState start numbers', () => {
  it('gives every start of a route id a new number, also after its records were freed', () => {
    const route = routeWithId('start-number-route')
    expect(executionState.startCount(route.id)).toBe(0)

    executionState.create({ route })
    const first = executionState.startCount(route.id)
    executionState.delete(route.id)
    expect(heldRecords([route.id])).toEqual({})
    executionState.create({ route })
    const second = executionState.startCount(route.id)
    executionState.delete(route.id)

    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
    expect(executionState.startCount('never-started-route')).toBe(0)
  })
})

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.2,
// case 3.
describe('executionState.lastEnded', () => {
  it('keeps the route and hook of the last ended execution while a stopped run is in flight', () => {
    const first = routeWithId('last-ended-route')
    const second = { ...first }
    const hook = vi.fn()
    expect(executionState.lastEnded(first.id)).toBeUndefined()

    executionState.create({ route: first })
    executionState.retain(first.id)
    executionState.delete(first.id)
    const started = executionState.startCount(first.id)
    executionState.create({
      route: second,
      executionOptions: { updateRouteHook: hook },
    })
    executionState.delete(second.id)
    // A delete without a running execution keeps the record while the
    // stopped run is in flight.
    executionState.delete(second.id)

    expect(executionState.lastEnded(first.id)?.route).toBe(second)
    expect(executionState.lastEnded(first.id)?.updateRouteHook).toBe(hook)
    expect(executionState.startCount(first.id)).toBeGreaterThan(started)
    expect(executionState.lastEnded('never-started-route')).toBeUndefined()

    executionState.release(first.id)
    expect(heldRecords([first.id])).toEqual({})
  })

  it('keeps nothing for a run that settled before its execution was deleted', () => {
    const route = routeWithId('settled-route')

    executionState.create({ route })
    executionState.retain(route.id)
    executionState.release(route.id)
    executionState.delete(route.id)

    expect(heldRecords([route.id])).toEqual({})
  })
})

// The records that let a late write of a stopped run find the newest route
// live only while such a run can still write.
describe('the lifetime of executionState records', () => {
  it('keeps no record of the routes that finished', async () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `done-${index}`)

    const routes = await Promise.all(
      ids.map((id) =>
        executeRoute(
          clientWith({
            allowUserInteraction: true,
            allowExecution: true,
            setInteraction: (): void => {},
            executeStep: async (
              _client: SDKClient,
              step: LiFiStepExtended
            ): Promise<LiFiStepExtended> => finishStep(step),
          }),
          routeWithId(id)
        )
      )
    )

    expect(
      routes.every((route) => route.steps[0].execution?.status === 'DONE')
    ).toBe(true)
    expect(heldRecords(ids)).toEqual({})
  })

  it('keeps the records of stopped routes until their steps settle', async () => {
    const runs = Array.from({ length: 50 }, (_, index) => {
      const route = routeWithId(`stopped-${index}`)
      const held = heldExecutor()
      return {
        route,
        held,
        run: executeRoute(clientWith(held.executor), route),
      }
    })
    const ids = runs.map(({ route }) => route.id)
    await Promise.all(runs.map(({ held }) => held.entered))

    for (const { route } of runs) {
      stopRouteExecution(route)
    }
    expect(heldRecords(ids)).toEqual({ starts: 50, ended: 50, inFlight: 50 })

    for (const { held } of runs) {
      held.release()
    }
    await Promise.all(runs.map(({ run }) => run))

    expect(heldRecords(ids)).toEqual({})
  })

  it('delivers a late write into the newer execution that finished, then frees its records', async () => {
    const route = routeWithId('late-after-finish-route')
    const oldStatusManager = new StatusManager(route.id)
    // The old step waits in the wallet prompt; the hash comes after the stop.
    const old = heldExecutor((step) => {
      oldStatusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      return step
    }, oldStatusManager)
    const newer = heldExecutor(finishStep)
    const client = clientWith(old.executor, newer.executor)
    const keptHook = vi.fn()
    const liveHook = vi.fn()

    const oldRun = executeRoute(client, route, { updateRouteHook: keptHook })
    await old.entered
    stopRouteExecution(route)
    const newerRun = resumeRoute(client, route, { updateRouteHook: liveHook })
    await newer.entered
    newer.release()
    const newerRoute = await newerRun

    expect(newerRoute.steps[0].execution?.status).toBe('DONE')
    expect(executionState.lastEnded(route.id)?.route).toBe(newerRoute)
    expect(executionState.lastEnded(route.id)?.updateRouteHook).toBe(liveHook)

    old.release()
    await oldRun

    expect(liveHook).toHaveBeenCalledTimes(1)
    expect(liveHook.mock.calls[0][0]).toBe(newerRoute)
    expect(swapOf(newerRoute)?.txHash).toBe('0xlate')
    expect(keptHook).not.toHaveBeenCalled()
    expect(heldRecords([route.id])).toEqual({})
  })

  it('frees the records when the newer execution finishes after the stopped step settled', async () => {
    const route = routeWithId('settled-before-finish-route')
    const old = heldExecutor()
    const newer = heldExecutor(finishStep)
    const client = clientWith(old.executor, newer.executor)

    const oldRun = executeRoute(client, route)
    await old.entered
    stopRouteExecution(route)
    const newerRun = resumeRoute(client, route)
    await newer.entered
    old.release()
    await oldRun
    newer.release()
    await newerRun

    expect(heldRecords([route.id])).toEqual({})
  })

  it('keeps the stopped run in flight through the ExecuteStepRetryError retry', async () => {
    const route = routeWithId('retry-route')
    const statusManager = new StatusManager(route.id)
    const retried = heldExecutor((step) => {
      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      return step
    }, statusManager)
    const executeStep = retried.executor.executeStep
    let calls = 0
    retried.executor.executeStep = async (client, step, retryParams) => {
      calls++
      if (calls === 1) {
        throw new ExecuteStepRetryError('Retry the step.', { retry: true })
      }
      // `executeSteps` cleared the execution for the retry.
      step.execution = {
        startedAt: SOME_DATE,
        status: 'PENDING',
        actions: [{ type: 'SWAP', status: 'PENDING' }],
      }
      return executeStep(client, step, retryParams)
    }
    const keptHook = vi.fn()

    const run = executeRoute(clientWith(retried.executor), route, {
      updateRouteHook: keptHook,
    })
    await retried.entered
    stopRouteExecution(route)
    retried.release()
    const keptRoute = await run

    expect(calls).toBe(2)
    expect(keptHook).toHaveBeenCalledTimes(1)
    expect(keptHook.mock.calls[0][0]).toBe(keptRoute)
    expect(swapOf(keptRoute)?.txHash).toBe('0xlate')
    expect(heldRecords([route.id])).toEqual({})
  })

  // A writer can outlive its step (a promise the task did not await). Its
  // records are gone then, and its late write must not take the route of a
  // newer execution for its own kept route.
  it('never lets a late write of a settled run reach its kept route after the route id started again', () => {
    const oldRoute = routeWithId('restarted-route')
    const keptHook = vi.fn()
    executionState.create({
      route: oldRoute,
      executionOptions: { updateRouteHook: keptHook },
    })
    const statusManager = new StatusManager(oldRoute.id)
    executionState
      .get(oldRoute.id)!
      .executors.push(heldExecutor(undefined, statusManager).executor)
    // The old step runs, as `executeSteps` counts it.
    executionState.retain(oldRoute.id)
    stopRouteExecution(oldRoute)
    // The old step settles; its detached writer is still to come.
    executionState.release(oldRoute.id)
    expect(heldRecords([oldRoute.id])).toEqual({})

    // A newer execution starts and stops while its step runs.
    const newerRoute = routeWithId(oldRoute.id)
    const liveHook = vi.fn()
    executionState.create({
      route: newerRoute,
      executionOptions: { updateRouteHook: liveHook },
    })
    executionState.retain(newerRoute.id)
    stopRouteExecution(newerRoute)

    statusManager.updateAction(oldRoute.steps[0], 'SWAP', 'PENDING', LATE_WRITE)

    expect(keptHook).not.toHaveBeenCalled()
    expect(liveHook).toHaveBeenCalledTimes(1)
    expect(swapOf(newerRoute)?.txHash).toBe('0xlate')

    executionState.release(newerRoute.id)
    expect(heldRecords([oldRoute.id])).toEqual({})
  })
})
