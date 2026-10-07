import type { LiFiStep } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionSequence,
  buildNetworkRoute,
  buildNetworkStep,
  createFakeNetwork,
  DESTINATION_CHAIN_ID,
  DIAMOND_ADDRESS,
  decodeDiamondCall,
  destinationHashOf,
  EXPLORER_URLS,
  type FakeNetwork,
  moneyFields,
  type NetworkPage,
  openNetworkPage,
  SOURCE_CHAIN_ID,
  USDC,
  USDC_ARB,
  USDC_POLYGON,
  USDT,
  USDT_POLYGON,
} from './network.mock.js'

/** Step 1 quotes 1.49 USDT, but the swap delivers 1.487 USDT. */
const STEP_1_ESTIMATE = '1490000'
const STEP_1_RECEIVED = '1487000'
const STEP_2_TO_AMOUNT = '1480000'

let network: FakeNetwork

beforeEach(() => {
  network = createFakeNetwork({
    allowances: [
      { token: USDC_POLYGON, amount: 10n ** 12n },
      { token: USDT_POLYGON, amount: 10n ** 12n },
    ],
    receivedAmount: (quote: LiFiStep) =>
      quote.id === 'step-1-swap' ? STEP_1_RECEIVED : quote.estimate.toAmount,
  })
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

/** USDC → USDT on Polygon, then USDT on Polygon → USDC on Arbitrum. */
const openTwoStepPage = (): NetworkPage =>
  openNetworkPage({
    network,
    route: buildNetworkRoute([
      buildNetworkStep({
        id: 'step-1-swap',
        fromToken: USDC,
        toToken: USDT,
        fromAmount: '1500000',
        toAmount: STEP_1_ESTIMATE,
        tool: 'paraswap',
      }),
      buildNetworkStep({
        id: 'step-2-bridge',
        fromToken: USDT,
        toToken: USDC_ARB,
        fromAmount: STEP_1_ESTIMATE,
        toAmount: STEP_2_TO_AMOUNT,
        tool: 'stargate',
      }),
    ]),
  })

const link = (chainId: number, hash: string): string =>
  `${EXPLORER_URLS[chainId]}tx/${hash}`

describe('a two-step route', () => {
  it('starts step 2 only after step 1 is DONE, and ends with both DONE', async () => {
    const page = openTwoStepPage()
    const route = await page.run()

    const firstStep2Snapshot = page.snapshots.findIndex(
      (snapshot) => snapshot.steps[1].execution !== undefined
    )
    expect(firstStep2Snapshot).toBeGreaterThan(0)
    expect(
      page.snapshots[firstStep2Snapshot - 1].steps[0].execution?.status
    ).toBe('DONE')

    expect(actionSequence(page.snapshots, 0)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(actionSequence(page.snapshots, 1)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])
    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
      '/status',
      '/advanced/stepTransaction',
      '/status',
    ])

    const [swap, bridge] = network.signed
    const actionsOf = (index: number) =>
      route.steps[index].execution?.actions.map(
        ({ type, status, chainId, txHash, txLink }) => ({
          type,
          status,
          chainId,
          txHash,
          txLink,
        })
      )
    expect(route.steps.map((step) => step.execution?.status)).toEqual([
      'DONE',
      'DONE',
    ])
    expect(actionsOf(0)).toEqual([
      {
        type: 'CHECK_ALLOWANCE',
        status: 'DONE',
        chainId: SOURCE_CHAIN_ID,
        txHash: undefined,
        txLink: undefined,
      },
      // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
      {
        type: 'SWAP',
        status: 'DONE',
        chainId: SOURCE_CHAIN_ID,
        txHash: swap.hash,
        txLink: link(SOURCE_CHAIN_ID, swap.hash),
      },
    ])
    const destinationHash = destinationHashOf(bridge.hash)
    expect(actionsOf(1)).toEqual([
      {
        type: 'CHECK_ALLOWANCE',
        status: 'DONE',
        chainId: SOURCE_CHAIN_ID,
        txHash: undefined,
        txLink: undefined,
      },
      {
        type: 'CROSS_CHAIN',
        status: 'DONE',
        chainId: SOURCE_CHAIN_ID,
        txHash: bridge.hash,
        txLink: link(SOURCE_CHAIN_ID, bridge.hash),
      },
      {
        type: 'RECEIVING_CHAIN',
        status: 'DONE',
        chainId: DESTINATION_CHAIN_ID,
        txHash: destinationHash,
        txLink: link(DESTINATION_CHAIN_ID, destinationHash),
      },
    ])
    expect(route.steps[1].execution?.toAmount).toBe(STEP_2_TO_AMOUNT)
  })

  it("re-quotes and signs step 2 with step 1's received amount", async () => {
    const page = openTwoStepPage()
    const route = await page.run()

    expect(route.steps[0].execution?.toAmount).toBe(STEP_1_RECEIVED)
    expect(route.steps[1].action.fromAmount).toBe(STEP_1_RECEIVED)
    expect(network.api[2].body?.action.fromAmount).toBe(STEP_1_RECEIVED)

    expect(network.signed).toHaveLength(2)
    expect(network.signedMessages).toEqual([])
    expect(page.switches).toEqual([])
    const [swap, bridge] = network.signed
    const [firstQuote, secondQuote] = network.quotes
    expect(moneyFields(swap)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: DIAMOND_ADDRESS,
      data: firstQuote.transactionRequest.data,
      value: 0n,
    })
    expect(decodeDiamondCall(swap.data!)).toEqual({
      functionName: 'swap',
      args: [firstQuote.quoteId, USDC_POLYGON, 1_500_000n, USDT_POLYGON],
    })
    expect(moneyFields(bridge)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: DIAMOND_ADDRESS,
      data: secondQuote.transactionRequest.data,
      value: 0n,
    })
    expect(decodeDiamondCall(bridge.data!)).toEqual({
      functionName: 'bridge',
      args: [
        secondQuote.quoteId,
        USDT_POLYGON,
        BigInt(STEP_1_RECEIVED),
        BigInt(DESTINATION_CHAIN_ID),
      ],
    })
    expect(network.broadcast).toEqual([swap.serialized, bridge.serialized])
  })
})
