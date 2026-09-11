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
  buildChain,
  buildStep,
  buildTransactionRequest,
  createScenario,
  type Scenario,
} from './harness.mock.js'

/** Arbitrum. Any id other than the source chain's makes the step a bridge. */
const DESTINATION_CHAIN_ID = 42161

/**
 * The same standard-approval shape the other scenarios use, but bridging.
 * `BaseStepExecutor.createBaseContext` sets `isBridgeExecution` from
 * `fromChain.id !== toChain.id`, and that one boolean re-targets every
 * `findAction` / `initializeAction` in the pipeline from `SWAP` to
 * `CROSS_CHAIN`.
 */
const buildBridgeScenario = (): Scenario =>
  createScenario({
    step: buildStep({
      transactionRequest: buildTransactionRequest(),
      toChainId: DESTINATION_CHAIN_ID,
    }),
    toChain: buildChain({ id: DESTINATION_CHAIN_ID }),
    allowance: 10n ** 24n,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('C11 — a cross-chain step uses CROSS_CHAIN, not SWAP', () => {
  it('names the action CROSS_CHAIN throughout', async () => {
    const scenario = buildBridgeScenario()

    await scenario.run()

    const actionTypes = new Set(
      scenario.events('action').map((event) => event.actionType)
    )
    expect(actionTypes.has('CROSS_CHAIN')).toBe(true)
    expect(actionTypes.has('SWAP')).toBe(false)
  })

  it('marks the bridge action DONE on the source chain, before any destination status', async () => {
    const scenario = buildBridgeScenario()

    await scenario.run()

    // Pinned as observed, and it is the one real difference between the bridge
    // and swap lanes on the source chain: `EthereumStandardWaitForTransactionTask.ts:59-61`
    // adds a DONE for a bridge that a same-chain swap never gets, so the
    // consumer is told the bridge action completed as soon as the source
    // receipt lands — the destination leg is a separate `RECEIVING_CHAIN`
    // action that `WaitForTransactionStatusTask` owns.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:MESSAGE_REQUIRED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
    ])

    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'CROSS_CHAIN:DONE',
    ])
  })

  it('still sends one source-chain transaction', async () => {
    const scenario = buildBridgeScenario()

    await scenario.run()

    // The bridge is an ordinary source-chain transaction; nothing about the
    // destination chain reaches the wallet.
    const sent = scenario.events('sendTransaction')
    expect(sent).toHaveLength(1)
    expect(scenario.events('sendCalls')).toEqual([])
    expect(scenario.executedStep().action.toChainId).toBe(DESTINATION_CHAIN_ID)
  })
})
