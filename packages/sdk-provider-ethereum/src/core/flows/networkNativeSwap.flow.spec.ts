import { zeroAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionSequence,
  buildNetworkRoute,
  buildNetworkStep,
  createFakeNetwork,
  DIAMOND_ADDRESS,
  decodeDiamondCall,
  EXPLORER_URLS,
  type FakeNetwork,
  moneyFields,
  type NetworkPage,
  openNetworkPage,
  POL,
  SOURCE_CHAIN_ID,
  START_NATIVE_BALANCE,
  USDC,
  USDC_POLYGON,
  WALLET_ADDRESS,
} from './network.mock.js'

/** 1 POL. */
const FROM_AMOUNT = 10n ** 18n
const TO_AMOUNT = '990000'
/**
 * `receiving.amount` of the fake `/status`. Not the quoted `TO_AMOUNT`, so the
 * final `execution.toAmount` shows that it comes from `/status`.
 */
const RECEIVED_AMOUNT = '987654'

let network: FakeNetwork

beforeEach(() => {
  network = createFakeNetwork({ receivedAmount: () => RECEIVED_AMOUNT })
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

/** POL → USDC on Polygon: no allowance, one transaction carrying value. */
const openNativeSwapPage = (): NetworkPage =>
  openNetworkPage({
    network,
    route: buildNetworkRoute([
      buildNetworkStep({
        id: 'native-swap',
        fromToken: POL,
        toToken: USDC,
        fromAmount: FROM_AMOUNT.toString(),
        toAmount: TO_AMOUNT,
        tool: 'paraswap',
      }),
    ]),
  })

describe('a native-token swap, through the real viem actions', () => {
  it('signs one transaction that sends the native amount to the diamond', async () => {
    const page = openNativeSwapPage()
    await page.run()

    // The wallet signed exactly the quote's calldata, with the amount as
    // value, and that signed transaction is what reached the node.
    const [quote] = network.quotes
    expect(network.signed).toHaveLength(1)
    const [swap] = network.signed
    expect(moneyFields(swap)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: DIAMOND_ADDRESS,
      data: quote.transactionRequest.data,
      value: FROM_AMOUNT,
    })
    expect(decodeDiamondCall(swap.data!)).toEqual({
      functionName: 'swap',
      args: [quote.quoteId, zeroAddress, FROM_AMOUNT, USDC_POLYGON],
    })
    expect(network.broadcast).toEqual([swap.serialized])
    expect(network.signedMessages).toEqual([])
    expect(page.switches).toEqual([])

    // The fake chain executed it: the diamond took the value, nothing else.
    expect(network.receiptStatus(swap.hash)).toBe('success')
    expect(network.nativeBalanceOf(SOURCE_CHAIN_ID, WALLET_ADDRESS)).toBe(
      START_NATIVE_BALANCE - FROM_AMOUNT
    )
  })

  it('checks the balance on the SDK public client, then quotes and polls /status once', async () => {
    await openNativeSwapPage().run()

    // The balance check runs through `getPublicClient` → `http(url)` →
    // this test's `fetch`: the seam this harness relies on. Not pinned:
    // `eth_blockNumber`. `getPublicClient` keeps one client per chain for the
    // whole file and viem caches that client's block number for 4 s, so only
    // the first test of a file sends it.
    expect(
      network.rpc
        .filter(
          (call) => call.via === 'public' && call.method !== 'eth_blockNumber'
        )
        .map((call) => call.method)
    ).toEqual(['eth_getCode', 'eth_getBalance'])
    expect(
      network.rpc
        .filter((call) => call.method === 'eth_sendRawTransaction')
        .map((call) => call.via)
    ).toEqual(['wallet'])

    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
      '/status',
    ])
    expect(network.api[1].query).toEqual({
      fromChain: String(SOURCE_CHAIN_ID),
      fromAddress: WALLET_ADDRESS,
      toChain: String(SOURCE_CHAIN_ID),
      txHash: network.signed[0].hash,
      bridge: 'paraswap',
    })
  })

  it('tells the consumer STARTED, ACTION_REQUIRED, PENDING, DONE and ends DONE', async () => {
    const page = openNativeSwapPage()
    const route = await page.run()

    expect(actionSequence(page.snapshots)).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])

    const hash = network.signed[0].hash
    const execution = route.steps[0].execution!
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
        txHash: hash,
        txLink: `${EXPLORER_URLS[SOURCE_CHAIN_ID]}tx/${hash}`,
      },
    ])
  })
})
