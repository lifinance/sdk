import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Keeps the real `WaitForTransactionStatusTask` and fakes `/v1/status` at
 * `fetch`. `EthereumProvider` is wrapped by `actionControls.mock.ts` so an
 * `acceptExchangeRateUpdateHook` reaches the executor. `recordRouteUpdates`
 * copies every `updateRouteHook` fire for `routeUpdateSequence`.
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

import type { LiFiStep, SDKError } from '@lifi/sdk'
import { type Hex, numberToHex } from 'viem'
import {
  createStatusApi,
  routeUpdateSequence,
  type StatusApi,
  walletControls,
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

/** The calldata of the route the user saw. */
const SWAP_CALLDATA: Hex = `0x${'ec'.repeat(36)}`

/** The calldata of the re-quote: the one the wallet must sign. */
const REQUOTED_CALLDATA: Hex = `0x${'ed'.repeat(36)}`

/**
 * The re-quote is about 10 % worse than the route the user saw: the
 * fixture's `toAmountMin` is 1445300 with 3 % slippage, so 1300000 is past
 * `checkStepSlippageThreshold`.
 */
const NEW_TO_AMOUNT = '1340000'
const NEW_TO_AMOUNT_MIN = '1300000'

/**
 * What `/status` says arrived. It differs from the fixture's
 * `estimate.toAmount` (1490000) and from the re-quote's (1340000), so the
 * final `toAmount` shows its source.
 */
const RECEIVED_AMOUNT = '1330000'

/** What the hook is asked: the old and the new amount of the same token. */
const RATE_UPDATE = {
  oldToAmount: '1490000',
  newToAmount: NEW_TO_AMOUNT,
  toToken: TO_TOKEN,
}

/**
 * The EA1 native swap, re-quoted at the worse rate. The re-quote carries its
 * own transaction, so a send of the old one shows.
 */
const buildRateScenario = (): Scenario => {
  const step = buildStep({
    transactionRequest: buildTransactionRequest({
      data: SWAP_CALLDATA,
      value: numberToHex(BigInt(FROM_AMOUNT)),
    }),
  })
  step.action.fromToken = NATIVE_TOKEN
  return createScenario({
    step,
    onStepTransaction: (requested: LiFiStep) => {
      const { typedData: _typedData, ...rest } = requested
      return {
        ...rest,
        estimate: {
          ...rest.estimate,
          toAmount: NEW_TO_AMOUNT,
          toAmountMin: NEW_TO_AMOUNT_MIN,
        },
        transactionRequest: buildTransactionRequest({
          data: REQUOTED_CALLDATA,
          value: numberToHex(BigInt(FROM_AMOUNT)),
        }),
      } as LiFiStep
    },
  })
}

let statusApi: StatusApi

beforeEach(() => {
  vi.clearAllMocks()
  walletControls.reset()
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

describe('EA5 — the exchange rate changed past the slippage', () => {
  it('accepted: asks the hook once, then sends the re-quote and completes', async () => {
    const accept = vi.fn(async () => true)
    walletControls.acceptExchangeRateUpdateHook = accept
    const scenario = buildRateScenario()

    await scenario.run()

    expect(accept).toHaveBeenCalledTimes(1)
    expect(accept).toHaveBeenCalledWith(RATE_UPDATE)
    // The wallet signs the re-quote's transaction, not the one the user saw.
    expect(walletControls.sendAttempts).toEqual([
      {
        to: APPROVAL_ADDRESS,
        data: REQUOTED_CALLDATA,
        value: BigInt(FROM_AMOUNT),
        chainId: CHAIN_ID,
        rejected: false,
      },
    ])
    expect(scenario.events('sendTransaction')).toHaveLength(1)
    expect(routeUpdateSequence(scenario)).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])

    // The harness wallet answers the first send with hash 0x…01.
    const txHash = `0x${'1'.padStart(64, '0')}`
    expect(statusApi.queries.map((query) => query.txHash)).toEqual([txHash])
    const step = scenario.executedStep()
    expect(step.estimate.toAmount).toBe(NEW_TO_AMOUNT)
    const execution = step.execution!
    expect(execution.status).toBe('DONE')
    expect(execution.toAmount).toBe(RECEIVED_AMOUNT)
    const swap = execution.actions.find((action) => action.type === 'SWAP')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(swap?.txHash).toBe(txHash)
    expect(swap?.txLink).toBe(`https://polygonscan.example/tx/${txHash}`)
  })

  it('declined: fails with ExchangeRateUpdateCanceled and sends nothing', async () => {
    const decline = vi.fn(async () => false)
    walletControls.acceptExchangeRateUpdateHook = decline
    const scenario = buildRateScenario()

    const error = (await scenario.runExpectingFailure()) as SDKError

    expect(decline).toHaveBeenCalledTimes(1)
    expect(decline).toHaveBeenCalledWith(RATE_UPDATE)
    expect(error.code).toBe(1016)
    // The wallet never showed a prompt, so nothing was sent and /status was
    // never asked.
    expect(walletControls.sendAttempts).toEqual([])
    expect(scenario.events('sendTransaction')).toEqual([])
    expect(statusApi.queries).toEqual([])
    expect(routeUpdateSequence(scenario)).toEqual([
      'SWAP:STARTED',
      'SWAP:FAILED',
    ])
    const step = scenario.executedStep()
    // The step keeps the rate the user saw.
    expect(step.estimate.toAmount).toBe('1490000')
    const execution = step.execution!
    expect(execution.status).toBe('FAILED')
    expect(execution.error?.code).toBe(1016)
    const swap = execution.actions.find((action) => action.type === 'SWAP')
    expect(swap?.status).toBe('FAILED')
    expect(swap?.txHash).toBeUndefined()
  })
})
