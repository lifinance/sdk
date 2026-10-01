import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  InteractionSettings,
  LiFiStepExtended,
  RouteExtended,
  SDKClient,
  StepExecutor,
} from '../types/core.js'
import {
  executeRoute,
  getActiveRoute,
  resumeRoute,
  stopRouteExecution,
} from './execution.js'
import {
  attachStatusManager,
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { StatusManager } from './StatusManager.js'
import { CLEARED_TRANSACTION_FIELDS } from './transactionState.js'

describe('resumeRoute', () => {
  it('prepares the restart on a copy and leaves the caller route unchanged', async () => {
    // Step already DONE, so executeSteps skips it and no provider is needed.
    const route = {
      id: 'route-clone-test',
      steps: [
        {
          id: 'step-1',
          action: { fromAddress: '0xabc' },
          transactionRequest: { data: '0xdata' },
          execution: {
            startedAt: 0,
            status: 'DONE',
            actions: [
              {
                type: 'SWAP',
                status: 'FAILED',
                txHash: '0xswap',
                txFinal: true,
              },
            ],
          },
        },
      ],
    } as unknown as RouteExtended
    const before = JSON.parse(JSON.stringify(route))

    const resumed = await resumeRoute(
      { providers: [] } as unknown as SDKClient,
      route
    )

    expect(JSON.parse(JSON.stringify(route))).toEqual(before)
    expect(resumed.steps[0].execution!.actions).toEqual([])
    expect(resumed.steps[0].transactionRequest).toBeUndefined()
  })
})

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.2.
describe('a late transaction write after stopRouteExecution', () => {
  afterEach(() => {
    executionState.delete(buildRouteObject({}).id)
  })

  it.each([
    ['executeRoute', executeRoute],
    ['resumeRoute', resumeRoute],
  ] as const)(
    'merges into a newer execution started with %s',
    async (_, start) => {
      // The old execution, stopped while its task still runs.
      const oldStep = buildStepObject({ includingExecution: true })
      const oldRoute = buildRouteObject({ step: oldStep })
      executionState.create({
        route: oldRoute,
        executionOptions: { updateRouteHook: vi.fn() },
      })
      const oldStatusManager = new StatusManager(oldRoute.id)
      attachStatusManager(oldRoute.id, oldStatusManager)
      stopRouteExecution(oldRoute)

      // The newer execution, held inside its step.
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const executor: StepExecutor = {
        allowUserInteraction: true,
        allowExecution: true,
        setInteraction: (): void => {},
        executeStep: async (
          _client: SDKClient,
          step: LiFiStepExtended
        ): Promise<LiFiStepExtended> => {
          entered.resolve()
          await release.promise
          return step
        },
      }
      const client = {
        providers: [
          {
            isAddress: (): boolean => true,
            getStepExecutor: async () => executor,
          },
        ],
      } as unknown as SDKClient
      const liveHook = vi.fn()
      const running = start(
        client,
        buildRouteObject({
          step: buildStepObject({ includingExecution: true }),
        }),
        { updateRouteHook: liveHook }
      )
      await entered.promise

      oldStatusManager.updateAction(oldStep, 'SWAP', 'PENDING', {
        ...CLEARED_TRANSACTION_FIELDS,
        txHash: '0xlate',
        signedAt: SOME_DATE,
      })

      const liveRoute = getActiveRoute(oldRoute.id)!
      const swap = liveRoute.steps[0].execution?.actions.find(
        (action) => action.type === 'SWAP'
      )
      expect(swap?.txHash).toBe('0xlate')
      expect(liveHook).toHaveBeenCalledTimes(1)
      expect(liveHook.mock.calls[0][0]).toBe(liveRoute)

      release.resolve()
      await running
    }
  )
})

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.2:
// an old run never stops or deletes a newer execution of its route.
describe('a stopped run whose step ends after a newer execution started', () => {
  const routeId = buildRouteObject({}).id

  /** A step executor held inside `executeStep` until `release`. */
  const heldExecutor = (
    end: (step: LiFiStepExtended) => Promise<LiFiStepExtended>,
    options: { stoppable: boolean }
  ): {
    executor: StepExecutor
    entered: Promise<void>
    release: () => void
  } => {
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const executor: StepExecutor = {
      allowUserInteraction: true,
      allowExecution: true,
      setInteraction: (settings?: InteractionSettings): void => {
        if (options.stoppable) {
          executor.allowExecution = settings?.allowExecution ?? true
        }
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

  afterEach(() => {
    executionState.delete(routeId)
  })

  it.each([
    {
      name: 'ends without DONE',
      stoppable: true,
      end: async (step: LiFiStepExtended): Promise<LiFiStepExtended> => step,
    },
    {
      name: 'throws',
      stoppable: true,
      end: async (): Promise<LiFiStepExtended> => {
        throw new Error('HTTP request failed. Status: 503')
      },
    },
    {
      // An executor the stop did not reach finishes the route and cleans up.
      name: 'ends DONE on an executor the stop did not reach',
      stoppable: false,
      end: async (step: LiFiStepExtended): Promise<LiFiStepExtended> => {
        step.execution!.status = 'DONE'
        return step
      },
    },
  ])(
    'does not stop or delete the newer execution when the old step $name',
    async ({ stoppable, end }) => {
      const old = heldExecutor(end, { stoppable })
      const newer = heldExecutor(async (step) => step, { stoppable: true })
      const executors = [old.executor, newer.executor]
      const client = {
        providers: [
          {
            isAddress: (): boolean => true,
            getStepExecutor: async (): Promise<StepExecutor> =>
              executors.shift()!,
          },
        ],
      } as unknown as SDKClient
      const route = buildRouteObject({
        step: buildStepObject({ includingExecution: true }),
      })

      const oldRun = executeRoute(client, route).catch(
        (error: unknown) => error
      )
      await old.entered
      stopRouteExecution(route)
      const newerRun = resumeRoute(client, route)
      await newer.entered
      const newerRoute = getActiveRoute(routeId)

      old.release()
      await oldRun

      expect(getActiveRoute(routeId)).toBe(newerRoute)
      expect(newer.executor.allowExecution).toBe(true)

      newer.release()
      await newerRun
    }
  )

  // Spec addendum section 5.4: a stop during `getStepExecutor` does not reach
  // the executor that the old run gets after it.
  it('does not continue into the next step when the stop did not reach the old executor', async () => {
    const old = heldExecutor(async (step) => step, { stoppable: true })
    const newer = heldExecutor(async (step) => step, { stoppable: true })
    const nextStep: StepExecutor = {
      allowUserInteraction: true,
      allowExecution: true,
      setInteraction: (): void => {},
      executeStep: vi.fn(
        async (
          _client: SDKClient,
          step: LiFiStepExtended
        ): Promise<LiFiStepExtended> => step
      ),
    }
    const asked = Promise.withResolvers<void>()
    const handOut = Promise.withResolvers<void>()
    const getStepExecutor = vi
      .fn<() => Promise<StepExecutor>>()
      .mockImplementationOnce(async () => {
        asked.resolve()
        await handOut.promise
        return old.executor
      })
      .mockImplementationOnce(async () => newer.executor)
      .mockImplementation(async () => nextStep)
    const client = {
      providers: [{ isAddress: (): boolean => true, getStepExecutor }],
    } as unknown as SDKClient
    const firstStep = buildStepObject({ includingExecution: true })
    const route = {
      ...buildRouteObject({ step: firstStep }),
      steps: [
        firstStep,
        {
          ...buildStepObject({ includingExecution: false }),
          id: 'second-step',
        },
      ],
    }

    const oldRun = executeRoute(client, route)
    await asked.promise
    stopRouteExecution(route)
    const newerRun = resumeRoute(client, route)
    await newer.entered
    const newerRoute = getActiveRoute(routeId)

    old.release()
    handOut.resolve()
    const oldRoute = await oldRun

    expect(oldRoute.steps[0].execution?.status).toBe('PENDING')
    expect(getStepExecutor).toHaveBeenCalledTimes(2)
    expect(nextStep.executeStep).not.toHaveBeenCalled()
    expect(getActiveRoute(routeId)).toBe(newerRoute)
    expect(executionState.get(routeId)?.executors).toEqual([newer.executor])
    expect(newer.executor.allowExecution).toBe(true)

    newer.release()
    await newerRun
  })
})
