import { describe, expect, it } from 'vitest'
import { ExecuteStepRetryError } from '../errors/errors.js'
import type {
  ExecuteStepRetryParams,
  InteractionSettings,
  LiFiStepExtended,
  RouteExtended,
  SDKClient,
  StepExecutor,
} from '../types/core.js'
import { executeRoute, stopRouteExecution } from './execution.js'
import { buildRouteObject, buildStepObject } from './execution.unit.mock.js'
import { executionState } from './executionState.js'

// `executeSteps` replays a step once after `ExecuteStepRetryError`. A stop
// during the first attempt ends the run: the replay would be new work, with
// API calls, chain reads and integrator callbacks, on a stopped executor.

describe('ExecuteStepRetryError after stopRouteExecution', () => {
  it.each<{ name: string; retryParams: ExecuteStepRetryParams }>([
    {
      name: 'a strategy found at prepare',
      retryParams: { strategyAfterPrepare: 'relayed' },
    },
    { name: 'atomicityNotReady', retryParams: { atomicityNotReady: true } },
  ])(
    'starts no replay for $name, and executeRoute resolves',
    async ({ name, retryParams }) => {
      const route: RouteExtended = {
        ...buildRouteObject({
          step: buildStepObject({ includingExecution: false }),
        }),
        id: `retry-after-stop-${name}`,
      }
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      const attempts: (ExecuteStepRetryParams | undefined)[] = []
      const executor: StepExecutor = {
        allowUserInteraction: true,
        allowExecution: true,
        setInteraction: (settings?: InteractionSettings): void => {
          executor.allowUserInteraction = settings?.allowInteraction ?? true
          executor.allowExecution = settings?.allowExecution ?? true
        },
        executeStep: async (
          _client: SDKClient,
          _step: LiFiStepExtended,
          params?: ExecuteStepRetryParams
        ): Promise<LiFiStepExtended> => {
          attempts.push(params)
          if (params) {
            throw new Error('The replay ran on the stopped executor.')
          }
          // The first attempt awaits, for example, its re-quote. The stop
          // lands here.
          entered.resolve()
          await released.promise
          throw new ExecuteStepRetryError('Replay the step.', retryParams)
        },
      }
      const client = {
        providers: [
          {
            isAddress: (): boolean => true,
            getStepExecutor: async (): Promise<StepExecutor> => executor,
          },
        ],
      } as unknown as SDKClient

      const run = executeRoute(client, route)
      await entered.promise
      stopRouteExecution(route)
      released.resolve()

      await expect(run).resolves.toBeDefined()
      expect(attempts).toEqual([undefined])
      expect(executionState.state[route.id]).toBeUndefined()
      expect(executionState.inFlight[route.id]).toBeUndefined()
      expect(executionState.starts[route.id]).toBeUndefined()
      expect(executionState.ended[route.id]).toBeUndefined()
    }
  )
})
