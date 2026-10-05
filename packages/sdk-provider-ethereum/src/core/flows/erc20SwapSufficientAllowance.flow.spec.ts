import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Keeps the real `WaitForTransactionStatusTask` (as `destinationStatus` does)
 * and fakes `/v1/status` at `fetch`, so the step reaches `DONE` and the final
 * route can be pinned. `recordRouteUpdates` copies every `updateRouteHook`
 * fire for `routeUpdateSequence`.
 */
vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    ...(await import('./actionControls.mock.js')).recordRouteUpdates(actual),
    getStepTransaction: vi.fn(),
    getRelayerQuote: vi.fn(),
    relayTransaction: vi.fn(),
  }
})
vi.mock('../../client/publicClient.js')
vi.mock('../../actions/waitForTransactionReceipt.js')
vi.mock('../../actions/waitForRelayedTransactionReceipt.js')

import type { ExtendedChain } from '@lifi/sdk'
import type { Hex } from 'viem'
import {
  createStatusApi,
  routeUpdateSequence,
  type StatusApi,
} from './actionControls.mock.js'
import {
  APPROVAL_ADDRESS,
  buildChain,
  buildStep,
  buildTransactionRequest,
  CHAIN_ID,
  createScenario,
  FROM_ADDRESS,
  FROM_AMOUNT,
  FROM_TOKEN_ADDRESS,
  type Scenario,
  TO_TOKEN,
} from './harness.mock.js'

const SWAP_CALLDATA: Hex = `0x${'e2'.repeat(36)}`

/**
 * What `/status` says arrived. It differs from the fixture's
 * `estimate.toAmount` (1490000), so the final `toAmount` shows its source.
 */
const RECEIVED_AMOUNT = '1480000'

/**
 * A chain without Permit2 and without the Permit2Proxy: the classic lane,
 * where the allowance is read for the diamond and the swap goes to the
 * diamond. Spread, not `buildChain({ permit2: undefined })`: `buildChain`
 * destructures with defaults, so an explicit `undefined` gets the canonical
 * address back.
 */
const CLASSIC_CHAIN: ExtendedChain = {
  ...buildChain(),
  permit2: undefined,
  permit2Proxy: undefined,
} as unknown as ExtendedChain

/** Exactly the amount: one unit less would need an approval. */
const buildSufficientScenario = (): Scenario =>
  createScenario({
    chain: CLASSIC_CHAIN,
    step: buildStep({
      transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
    }),
    allowance: BigInt(FROM_AMOUNT),
  })

let statusApi: StatusApi

beforeEach(() => {
  vi.clearAllMocks()
  statusApi = createStatusApi({
    chainId: CHAIN_ID,
    fromAmount: FROM_AMOUNT,
    toToken: TO_TOKEN,
    toAmount: RECEIVED_AMOUNT,
  })
  vi.stubGlobal('fetch', statusApi.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(statusApi.unknown).toEqual([])
})

describe('EA2 — an ERC-20 same-chain swap with enough allowance', () => {
  it('reads the diamond allowance once and sends only the swap', async () => {
    const scenario = buildSufficientScenario()

    await scenario.run()

    expect(
      scenario
        .events('readContract')
        .map(({ address, functionName, args }) => ({
          address,
          functionName,
          args,
        }))
    ).toEqual([
      {
        address: FROM_TOKEN_ADDRESS,
        functionName: 'allowance',
        args: [FROM_ADDRESS, APPROVAL_ADDRESS],
      },
    ])
    expect(
      scenario
        .events('sendTransaction')
        .map(({ to, data, value }) => ({ to, data, value }))
    ).toEqual([{ to: APPROVAL_ADDRESS, data: SWAP_CALLDATA, value: 0n }])
    expect(scenario.events('signTypedData')).toEqual([])
    expect(scenario.events('sendCalls')).toEqual([])
  })

  it('tells the consumer the allowance check and the swap, and ends DONE', async () => {
    const scenario = buildSufficientScenario()

    await scenario.run()

    expect(routeUpdateSequence(scenario)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])

    // The harness wallet answers the first send with hash 0x…01.
    const txHash = `0x${'1'.padStart(64, '0')}`
    expect(statusApi.queries.map((query) => query.txHash)).toEqual([txHash])
    const execution = scenario.executedStep().execution!
    expect(execution.status).toBe('DONE')
    expect(execution.toAmount).toBe(RECEIVED_AMOUNT)
    expect(scenario.finalActions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'SWAP:DONE',
    ])
    const swap = execution.actions.find((action) => action.type === 'SWAP')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(swap?.txHash).toBe(txHash)
    expect(swap?.txLink).toBe(`https://polygonscan.example/tx/${txHash}`)
  })
})
