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

import { type Hex, numberToHex } from 'viem'
import {
  createStatusApi,
  routeUpdateSequence,
  type StatusApi,
} from './actionControls.mock.js'
import {
  APPROVAL_ADDRESS,
  buildStep,
  buildTransactionRequest,
  CHAIN_ID,
  createScenario,
  FROM_AMOUNT,
  NATIVE_TOKEN,
  type Scenario,
  TO_TOKEN,
} from './harness.mock.js'

const SWAP_CALLDATA: Hex = `0x${'5a'.repeat(36)}`

/**
 * What `/status` says arrived. It differs from the fixture's
 * `estimate.toAmount` (1490000), so the final `toAmount` shows its source.
 */
const RECEIVED_AMOUNT = '1480000'

/**
 * POL → USDT on Polygon. `buildStep` has no token option, so the fixture's
 * USDC is replaced with the chain's native token before the run; the native
 * check (`EthereumStepExecutor.createContext`) compares it to
 * `chain.nativeToken`.
 */
const buildNativeScenario = (): Scenario => {
  const step = buildStep({
    transactionRequest: buildTransactionRequest({
      data: SWAP_CALLDATA,
      value: numberToHex(BigInt(FROM_AMOUNT)),
    }),
  })
  step.action.fromToken = NATIVE_TOKEN
  return createScenario({ step })
}

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

describe('a native-token same-chain swap', () => {
  it('sends one transaction carrying the amount, with no allowance read and no signature', async () => {
    const scenario = buildNativeScenario()

    await scenario.run()

    expect(
      scenario
        .events('sendTransaction')
        .map(({ to, data, value }) => ({ to, data, value }))
    ).toEqual([
      { to: APPROVAL_ADDRESS, data: SWAP_CALLDATA, value: BigInt(FROM_AMOUNT) },
    ])
    expect(scenario.events('readContract')).toEqual([])
    expect(scenario.events('signTypedData')).toEqual([])
    expect(scenario.events('sendCalls')).toEqual([])
    expect(scenario.events('getStepTransaction')).toHaveLength(1)
  })

  it('tells the consumer STARTED, ACTION_REQUIRED, PENDING, DONE and ends DONE', async () => {
    const scenario = buildNativeScenario()

    await scenario.run()

    expect(routeUpdateSequence(scenario)).toEqual([
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
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(
      execution.actions.map(({ type, status, txHash, txLink }) => ({
        type,
        status,
        txHash,
        txLink,
      }))
    ).toEqual([
      {
        type: 'SWAP',
        status: 'DONE',
        txHash,
        txLink: `https://polygonscan.example/tx/${txHash}`,
      },
    ])
  })
})
