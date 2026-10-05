import type { SDKError } from '@lifi/sdk'
import { parseTransaction } from 'viem'
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
  type SignedTransaction,
  SOURCE_CHAIN_ID,
  START_TOKEN_BALANCE,
  USDC,
  USDC_POLYGON,
  USDT,
  USDT_POLYGON,
  WALLET_ADDRESS,
} from './network.mock.js'

/** 1.5 USDC. */
const FROM_AMOUNT = 1_500_000n
/** The diamond may already pull this much USDC: no approval is needed. */
const SEEDED_ALLOWANCE = 10n ** 12n

let network: FakeNetwork

beforeEach(() => {
  network = createFakeNetwork({
    allowances: [{ token: USDC_POLYGON, amount: SEEDED_ALLOWANCE }],
  })
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

/** USDC → USDT on Polygon, with enough allowance: one swap transaction. */
const openSwapPage = (): NetworkPage =>
  openNetworkPage({
    network,
    route: buildNetworkRoute([
      buildNetworkStep({
        id: 'reverting-swap',
        fromToken: USDC,
        toToken: USDT,
        fromAmount: FROM_AMOUNT.toString(),
        toAmount: '1490000',
        tool: 'paraswap',
      }),
    ]),
  })

const link = (hash: string): string =>
  `${EXPLORER_URLS[SOURCE_CHAIN_ID]}tx/${hash}`

/** The account nonce the wallet signed into the transaction. */
const nonceOf = (transaction: SignedTransaction): number | undefined =>
  parseTransaction(transaction.serialized).nonce

/** The money fields the wallet must sign for the `index`-th quote. */
const swapOfQuote = (index: number) => ({
  chainId: SOURCE_CHAIN_ID,
  to: DIAMOND_ADDRESS,
  data: network.quotes[index].transactionRequest.data,
  value: 0n,
})

/** The `index`-th quote's calldata, decoded. */
const decodedSwapOfQuote = (index: number) => ({
  functionName: 'swap',
  args: [
    network.quotes[index].quoteId,
    USDC_POLYGON,
    FROM_AMOUNT,
    USDT_POLYGON,
  ],
})

describe('EN4 — the swap reverts on chain, then "Try again"', () => {
  it('fails the step with TransactionFailed and never asks /status', async () => {
    network.revertNext = true
    const page = openSwapPage()

    const error = (await page.runExpectingFailure()) as SDKError
    expect(error.code).toBe(1003)
    expect(error.cause?.message).toBe('Transaction was reverted.')

    // The wallet signed exactly the quote's calldata, no value, and that
    // signed transaction is what reached the node.
    expect(network.quotes).toHaveLength(1)
    expect(network.signed).toHaveLength(1)
    const [reverted] = network.signed
    expect(moneyFields(reverted)).toEqual(swapOfQuote(0))
    expect(decodeDiamondCall(reverted.data!)).toEqual(decodedSwapOfQuote(0))
    expect(network.broadcast).toEqual([reverted.serialized])
    expect(network.signedMessages).toEqual([])
    expect(page.switches).toEqual([])

    // Mined with status 0x0: no money moved.
    expect(network.receiptStatus(reverted.hash)).toBe('reverted')
    expect(network.balanceOf(USDC_POLYGON, WALLET_ADDRESS)).toBe(
      START_TOKEN_BALANCE
    )
    expect(
      network.allowance(USDC_POLYGON, WALLET_ADDRESS, DIAMOND_ADDRESS)
    ).toBe(SEEDED_ALLOWANCE)

    // Pinned as observed, and it looks wrong (ledger finding F3): the error
    // parser (`parseEthereumErrors`, core `fetchTxErrorDetails`) sends the
    // reverted transaction hash to Tenderly, a service outside LI.FI, on every
    // on-chain revert, only to tell an out-of-gas revert apart. The fake
    // answers it and records the hash; no real network call is made.
    expect(network.tenderly).toEqual([reverted.hash])
    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
    ])

    expect(actionSequence(page.snapshots)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    const execution = page.latest().steps[0].execution!
    expect(execution.status).toBe('FAILED')
    expect(execution.error?.code).toBe(1003)
    expect(
      execution.actions.map(({ type, status, txHash, txLink }) => ({
        type,
        status,
        txHash,
        txLink,
      }))
    ).toEqual([
      {
        type: 'CHECK_ALLOWANCE',
        status: 'DONE',
        txHash: undefined,
        txLink: undefined,
      },
      // The reverted hash and its link, from `EthereumStandardSignAndExecuteTask`.
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: reverted.hash,
        txLink: link(reverted.hash),
      },
    ])
  })

  it('signs a new transaction from a new quote on "Try again" and completes', async () => {
    network.revertNext = true
    const page = openSwapPage()
    const error = (await page.runExpectingFailure()) as SDKError
    expect(error.code).toBe(1003)
    const firstLegEnds = page.snapshots.length

    const route = await page.retry()

    // Two quotes, and each signed transaction carries exactly its own quote.
    expect(network.quotes).toHaveLength(2)
    expect(network.signed).toHaveLength(2)
    const [reverted, retried] = network.signed
    expect(moneyFields(reverted)).toEqual(swapOfQuote(0))
    expect(decodeDiamondCall(reverted.data!)).toEqual(decodedSwapOfQuote(0))
    expect(moneyFields(retried)).toEqual(swapOfQuote(1))
    expect(decodeDiamondCall(retried.data!)).toEqual(decodedSwapOfQuote(1))
    expect(network.quotes[1].quoteId).not.toBe(network.quotes[0].quoteId)
    // A new transaction: the reverted one used up its nonce.
    expect(nonceOf(reverted)).toBeDefined()
    expect(nonceOf(retried)).toBe(nonceOf(reverted)! + 1)
    expect(retried.hash).not.toBe(reverted.hash)
    // What reached the node is what the wallet signed, in that order.
    expect(network.broadcast).toEqual([reverted.serialized, retried.serialized])
    expect(network.signedMessages).toEqual([])
    expect(page.switches).toEqual([])

    // On chain: the retry spent FROM_AMOUNT once; the revert spent nothing.
    expect(network.receiptStatus(reverted.hash)).toBe('reverted')
    expect(network.receiptStatus(retried.hash)).toBe('success')
    expect(network.balanceOf(USDC_POLYGON, WALLET_ADDRESS)).toBe(
      START_TOKEN_BALANCE - FROM_AMOUNT
    )
    expect(
      network.allowance(USDC_POLYGON, WALLET_ADDRESS, DIAMOND_ADDRESS)
    ).toBe(SEEDED_ALLOWANCE - FROM_AMOUNT)

    // Only the revert was looked up on Tenderly (finding F3, see test 1).
    expect(network.tenderly).toEqual([reverted.hash])
    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
      '/advanced/stepTransaction',
      '/status',
    ])
    expect(network.api[2].query).toEqual({
      fromChain: String(SOURCE_CHAIN_ID),
      fromAddress: WALLET_ADDRESS,
      toChain: String(SOURCE_CHAIN_ID),
      txHash: retried.hash,
      bridge: 'paraswap',
    })

    expect(actionSequence(page.snapshots, 0, firstLegEnds)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const execution = route.steps[0].execution!
    expect(execution.status).toBe('DONE')
    expect(execution.error).toBeUndefined()
    // The FAILED SWAP of the first leg is gone (core `prepareRestart`).
    expect(
      execution.actions.map(({ type, status, txHash, txLink }) => ({
        type,
        status,
        txHash,
        txLink,
      }))
    ).toEqual([
      {
        type: 'CHECK_ALLOWANCE',
        status: 'DONE',
        txHash: undefined,
        txLink: undefined,
      },
      // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
      {
        type: 'SWAP',
        status: 'DONE',
        txHash: retried.hash,
        txLink: link(retried.hash),
      },
    ])
  })
})
