import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Keeps the real `WaitForTransactionStatusTask` and fakes `/v1/status` at
 * `fetch`, so the retried step reaches `DONE`. `EthereumProvider` is wrapped
 * by `actionControls.mock.ts` so the user can reject the wallet prompt.
 * `recordRouteUpdates` copies every `updateRouteHook` fire for
 * `routeUpdateSequence`.
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
vi.mock('../../EthereumProvider.js', async (importOriginal) =>
  (await import('./actionControls.mock.js')).mockEthereumProviderModule(
    await importOriginal()
  )
)

import type { ExtendedChain, LiFiStep, SDKError } from '@lifi/sdk'
import type { Hex } from 'viem'
import {
  createStatusApi,
  routeUpdateSequence,
  type StatusApi,
  walletControls,
} from './actionControls.mock.js'
import {
  APPROVAL_ADDRESS,
  buildChain,
  buildStep,
  buildTransactionRequest,
  CHAIN_ID,
  createScenario,
  FROM_AMOUNT,
  type Scenario,
  TO_TOKEN,
} from './harness.mock.js'

const SWAP_CALLDATA: Hex = `0x${'4e'.repeat(36)}`

/**
 * What `/status` says arrived. It differs from the fixture's
 * `estimate.toAmount` (1490000), so the final `toAmount` shows its source.
 */
const RECEIVED_AMOUNT = '1480000'

/**
 * The EA2 lane: no Permit2, enough allowance, one wallet prompt. The
 * re-quote answers with a transaction, as the real endpoint does:
 * `prepareRestart` drops the step's `transactionRequest` before "Try again".
 */
const buildRejectScenario = (): Scenario =>
  createScenario({
    chain: {
      ...buildChain(),
      permit2: undefined,
      permit2Proxy: undefined,
    } as unknown as ExtendedChain,
    step: buildStep({
      transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
    }),
    allowance: BigInt(FROM_AMOUNT),
    onStepTransaction: (requested: LiFiStep) => {
      const { typedData: _typedData, ...rest } = requested
      return {
        ...rest,
        transactionRequest: buildTransactionRequest({ data: SWAP_CALLDATA }),
      } as LiFiStep
    },
  })

let statusApi: StatusApi

beforeEach(() => {
  vi.clearAllMocks()
  walletControls.reset()
  walletControls.rejectSends = 1
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

describe('EA3 — the user rejects the sendTransaction prompt', () => {
  it('fails the step with SignatureRejected and sends nothing', async () => {
    const scenario = buildRejectScenario()

    const error = (await scenario.runExpectingFailure()) as SDKError

    expect(error.code).toBe(1012)
    // The wallet showed the prompt once; nothing reached the harness wallet's
    // send, so nothing was sent and /status was never asked.
    expect(walletControls.sendAttempts).toEqual([
      { to: APPROVAL_ADDRESS, data: SWAP_CALLDATA, value: 0n, rejected: true },
    ])
    expect(scenario.events('sendTransaction')).toEqual([])
    expect(statusApi.queries).toEqual([])

    expect(routeUpdateSequence(scenario)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:FAILED',
    ])
    const execution = scenario.executedStep().execution!
    expect(execution.status).toBe('FAILED')
    expect(execution.error?.code).toBe(1012)
    const swap = execution.actions.find((action) => action.type === 'SWAP')
    expect(swap?.status).toBe('FAILED')
    expect(swap?.txHash).toBeUndefined()
  })

  it('asks the wallet again on "Try again" and completes', async () => {
    const scenario = buildRejectScenario()
    await scenario.runExpectingFailure()
    const retryStartsAt = scenario.timeline.length

    await scenario.retry()

    // The second prompt carries the same transaction, and this one is sent.
    expect(walletControls.sendAttempts).toEqual([
      { to: APPROVAL_ADDRESS, data: SWAP_CALLDATA, value: 0n, rejected: true },
      { to: APPROVAL_ADDRESS, data: SWAP_CALLDATA, value: 0n, rejected: false },
    ])
    expect(scenario.events('sendTransaction')).toHaveLength(1)
    // "Try again" re-quotes before it prompts again.
    expect(scenario.events('getStepTransaction', retryStartsAt)).toHaveLength(1)

    expect(routeUpdateSequence(scenario, retryStartsAt)).toEqual([
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
    expect(execution.error).toBeUndefined()
    expect(execution.toAmount).toBe(RECEIVED_AMOUNT)
    const swap = execution.actions.find((action) => action.type === 'SWAP')
    expect(swap?.status).toBe('DONE')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(swap?.txHash).toBe(txHash)
    expect(swap?.txLink).toBe(`https://polygonscan.example/tx/${txHash}`)
  })
})
