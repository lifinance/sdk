import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The only spec that does **not** stub `WaitForTransactionStatusTask`.
 *
 * Every other scenario stubs it because it polls `/status` over HTTP on a 5s
 * interval. This one keeps the real task and cuts the seam one level lower, at
 * `fetch` — the boundary `request()` actually calls — so the destination-status
 * leg runs for real. That is the only way to reach
 * `StatusManager.initializeAction`'s *reuse* branch: for a same-chain step the
 * task initializes an action of type `SWAP`, and a `SWAP` action already
 * exists, so the pipeline updates it in place instead of appending a second
 * one. Nothing else in the EVM pipeline initializes an action type twice.
 */
vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import {
  buildStep,
  buildTransactionRequest,
  CHAIN_ID,
  createScenario,
  FROM_ADDRESS,
  type Scenario,
  TO_TOKEN,
} from './harness.mock.js'

const DESTINATION_TX_HASH = `0x${'d0'.repeat(32)}`

/**
 * A `FullStatusData` complete enough for both consumers on this path:
 * `waitForTransactionStatus` rejects a response without `receiving`, and
 * `WaitForTransactionStatusTask` dereferences `sending.amount` and the gas
 * fields when it writes the final execution. `status: 'DONE'` on the first
 * poll matters — anything else makes `waitForResult` sleep 5 seconds.
 */
const DONE_STATUS = {
  status: 'DONE',
  substatus: 'COMPLETED',
  substatusMessage: 'The transfer is complete.',
  transactionId: 'flow-status',
  lifiExplorerLink: 'https://explorer.example/tx',
  bridgeExplorerLink: 'https://bridge.example/tx',
  sending: {
    amount: '1500000',
    gasAmount: '10000',
    gasAmountUSD: '0.01',
    gasPrice: '1',
    gasToken: TO_TOKEN,
    gasUsed: '21000',
  },
  receiving: {
    amount: '1490000',
    chainId: CHAIN_ID,
    token: TO_TOKEN,
    txHash: DESTINATION_TX_HASH,
    txLink: 'https://polygonscan.example/tx/destination',
  },
}

/**
 * Sufficient allowance, so only two actions ever exist: `CHECK_ALLOWANCE` and
 * the `SWAP` the status task later re-initializes.
 */
const buildStatusScenario = (): Scenario =>
  createScenario({
    step: buildStep({ transactionRequest: buildTransactionRequest() }),
    allowance: 10n ** 24n,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => DONE_STATUS,
    }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('C10 — the destination-status task re-initializes the SWAP action', () => {
  it('reuses the existing SWAP action rather than appending a second one', async () => {
    const scenario = buildStatusScenario()

    await scenario.run()

    // The call stream shows `SWAP` initialized a second time, at PENDING, by
    // `WaitForTransactionStatusTask.ts:43` — after the wait task has already
    // driven it to PENDING once.
    expect(
      scenario
        .events('action')
        .map((event) => `${event.actionType}:${event.status}`)
    ).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:MESSAGE_REQUIRED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])

    // But the array a consumer renders still has exactly two entries: the
    // second `initializeAction({ type: 'SWAP' })` finds the existing action and
    // updates it in place (StatusManager.ts:142-151). This is the assertion
    // that distinguishes reuse from create — a second `SWAP` entry would show
    // up here and nowhere else, and it would take over `actions.at(-1)`, which
    // is what the widget reads for its headline and its icon.
    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'SWAP:DONE',
    ])
    expect(scenario.finalActions().at(-1)).toBe('SWAP:DONE')
  })

  it('carries the destination receipt onto that same action and finishes the step', async () => {
    const scenario = buildStatusScenario()

    await scenario.run()

    const step = scenario.executedStep()
    const swapActions = step.execution!.actions.filter(
      (action) => action.type === 'SWAP'
    )
    expect(swapActions).toHaveLength(1)
    expect(swapActions[0].txHash).toBe(DESTINATION_TX_HASH)
    expect(swapActions[0].substatus).toBe('COMPLETED')

    expect(step.execution!.status).toBe('DONE')
    expect(step.execution!.toAmount).toBe('1490000')
  })

  it('asks /status for the source transaction, not the receipt hash it already has', async () => {
    const scenario = buildStatusScenario()

    await scenario.run()

    // `waitForTransactionStatus` is handed `action.txHash`, which at that point
    // is the hash the source-chain wait task wrote. Asserted positively: a
    // regression that passed `undefined`, the relayer task id or the approve
    // hash would also satisfy "not the destination hash".
    const sourceTxHash = scenario
      .events('action')
      .filter(
        (event) =>
          event.actionType === 'SWAP' &&
          event.status === 'PENDING' &&
          event.txHash
      )
      .at(-1)?.txHash
    expect(sourceTxHash).toBeDefined()

    const calls = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
    expect(calls).toHaveLength(1)
    const url = new URL(String(calls[0][0]))
    expect(url.pathname).toBe('/v1/status')
    expect(url.searchParams.get('fromChain')).toBe(String(CHAIN_ID))
    expect(url.searchParams.get('toChain')).toBe(String(CHAIN_ID))
    expect(url.searchParams.get('fromAddress')).toBe(FROM_ADDRESS)
    expect(url.searchParams.get('bridge')).toBe('1inch')
    expect(url.searchParams.get('txHash')).toBe(sourceTxHash)
    expect(url.searchParams.get('txHash')).not.toBe(DESTINATION_TX_HASH)
  })
})
