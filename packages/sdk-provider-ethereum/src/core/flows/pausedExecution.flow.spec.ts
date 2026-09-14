import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
    // The terminal destination-status watcher polls `getStatus` over HTTP on a
    // 5s interval and never settles under test. It runs after everything these
    // specs assert on; the rest of the pipeline stays real.
    WaitForTransactionStatusTask: class WaitForTransactionStatusTask {
      shouldRun = async (): Promise<boolean> => true
      run = async (): Promise<{ status: 'COMPLETED' }> => ({
        status: 'COMPLETED',
      })
    },
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import {
  buildStep,
  buildTransactionRequest,
  createScenario,
  type Scenario,
} from './harness.mock.js'

/**
 * Background execution: `executeRoute(client, route, { executeInBackground })`
 * is the only public route to `allowUserInteraction: false`.
 * `updateRouteExecution` turns the flag into
 * `setInteraction({ allowInteraction: false })` on every executor before the
 * step runs, and each task then stops at its own interaction gate with
 * `{ status: 'PAUSED' }`.
 *
 * The first gate a standard approval flow reaches is
 * `EthereumNativePermitTask.ts:99`, which is why this fixture gives the token
 * EIP-2612 support.
 */
const buildBackgroundScenario = (): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 0n,
    nativePermitSupported: true,
    executeInBackground: true,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C13 — background execution pauses at the first prompt', () => {
  it('resolves instead of throwing, having asked the wallet for nothing', async () => {
    const scenario = buildBackgroundScenario()

    // A PAUSED task is not an error: `TaskPipeline` stops, `executeStep`
    // returns the step, and `executeSteps` calls `stopRouteExecution` because
    // the execution never reached DONE. The consumer's promise resolves.
    await expect(scenario.run()).resolves.toBeDefined()

    expect(scenario.events('signTypedData')).toEqual([])
    expect(scenario.events('sendTransaction')).toEqual([])
    expect(scenario.events('sendCalls')).toEqual([])
  })

  it('announces the permit as ACTION_REQUIRED and then stops there', async () => {
    const scenario = buildBackgroundScenario()

    await scenario.run()

    // Pinned as observed, and it is the shape a consumer has to render for a
    // backgrounded route: the action is raised to ACTION_REQUIRED *before* the
    // interaction gate is checked (`EthereumNativePermitTask.ts:97-101`), so
    // the list ends on a prompt that was never actually shown to the user.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:STARTED',
      'NATIVE_PERMIT:ACTION_REQUIRED',
    ])

    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'NATIVE_PERMIT:ACTION_REQUIRED',
    ])
    // What the widget's headline reads while the route sits paused.
    expect(scenario.finalActions().at(-1)).toBe('NATIVE_PERMIT:ACTION_REQUIRED')
  })

  it('leaves the execution ACTION_REQUIRED, not FAILED and not DONE', async () => {
    const scenario = buildBackgroundScenario()

    await scenario.run()

    // A pause is not a failure: nothing writes `FAILED`, so a consumer that
    // branches on `execution.status` cannot distinguish "waiting for the user"
    // from "still working" without reading the action list.
    expect(scenario.executedStep().execution?.status).toBe('ACTION_REQUIRED')
    expect(scenario.executedStep().execution?.error).toBeUndefined()
  })
})
