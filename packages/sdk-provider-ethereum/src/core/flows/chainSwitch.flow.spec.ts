import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Keeps the real `WaitForTransactionStatusTask` and fakes `/v1/status` at
 * `fetch`. `EthereumProvider` is wrapped by `actionControls.mock.ts` so the
 * wallet can start on another chain. `recordRouteUpdates` copies every
 * `updateRouteHook` fire for `routeUpdateSequence`.
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

/** Ethereum mainnet: the wallet is connected here when the page opens. */
const WALLET_START_CHAIN_ID = 1

const SWAP_CALLDATA: Hex = `0x${'c5'.repeat(36)}`

/**
 * What `/status` says arrived. It differs from the fixture's
 * `estimate.toAmount` (1490000), so the final `toAmount` shows its source.
 */
const RECEIVED_AMOUNT = '1480000'

/**
 * The EA1 native swap: no allowance task runs, so the first chain check
 * (`checkClient`) is the one in `EthereumPrepareTransactionTask`, after the
 * re-quote and before `ACTION_REQUIRED` and the wallet prompt.
 */
const buildSwitchScenario = (): Scenario => {
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
  walletControls.reset()
  walletControls.startChainId = WALLET_START_CHAIN_ID
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

describe('EA4 — the wallet is on another chain', () => {
  it('asks the wallet to switch to the source chain once, before the prompt', async () => {
    const scenario = buildSwitchScenario()

    await scenario.run()

    expect(walletControls.switches).toEqual([CHAIN_ID])
    expect(walletControls.log).toEqual([
      `switchChain:${CHAIN_ID}`,
      'sendTransaction',
    ])
    expect(
      scenario
        .events('sendTransaction')
        .map(({ to, data, value }) => ({ to, data, value }))
    ).toEqual([
      { to: APPROVAL_ADDRESS, data: SWAP_CALLDATA, value: BigInt(FROM_AMOUNT) },
    ])
  })

  it('shows no extra action for the switch and ends DONE', async () => {
    const scenario = buildSwitchScenario()

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
    const swap = execution.actions.find((action) => action.type === 'SWAP')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(swap?.txHash).toBe(txHash)
    expect(swap?.txLink).toBe(`https://polygonscan.example/tx/${txHash}`)
  })
})
