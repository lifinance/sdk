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

/**
 * The native swap of `networkNativeSwap.flow.spec.ts`, started with
 * `executeInBackground: true`.
 */
const openBackgroundPage = (): NetworkPage =>
  openNetworkPage({
    network,
    executeInBackground: true,
    route: buildNetworkRoute([
      buildNetworkStep({
        id: 'background-swap',
        fromToken: POL,
        toToken: USDC,
        fromAmount: FROM_AMOUNT.toString(),
        toAmount: TO_AMOUNT,
        tool: 'paraswap',
      }),
    ]),
  })

/** The JSON-RPC methods that reached the wallet's EIP-1193 transport. */
const walletMethods = (): string[] =>
  network.rpc.filter((call) => call.via === 'wallet').map((call) => call.method)

describe('background execution, then a foreground resume', () => {
  it('pauses at the swap prompt without signing anything', async () => {
    const page = openBackgroundPage()

    // A pause is not an error: the consumer's promise resolves.
    const route = await page.run()

    // The wallet's account signed nothing, and nothing reached the node.
    expect(network.signed).toEqual([])
    expect(network.signedMessages).toEqual([])
    expect(network.broadcast).toEqual([])
    expect(page.switches).toEqual([])
    expect(network.nativeBalanceOf(SOURCE_CHAIN_ID, WALLET_ADDRESS)).toBe(
      START_NATIVE_BALANCE
    )

    // Where main pauses: `EthereumPrepareTransactionTask` runs in full, then
    // `EthereumSignAndExecuteTask` sets ACTION_REQUIRED and returns PAUSED at
    // its `if (!allowUserInteraction)` gate, before it picks a strategy. The
    // prepare task makes the four wallet reads below. Since JUMEMB-102 it
    // resolves the strategy right after the re-quote, before it builds the
    // transaction request: first the strategy's own `checkClient`
    // (`eth_chainId`) and the batching probe (`wallet_getCapabilities`). Then
    // the chain check of `checkClient` (`eth_chainId`) and the fee read on
    // the wallet client (`eth_getBlockByNumber`): it makes these two only for
    // a local account, as in this harness (a json-rpc wallet skips them and
    // takes the fee from the quote). The sign task's gate is the only one
    // that this same-chain path reaches. A local account on another chain
    // pauses earlier: in background mode `switchChain` returns no client, and
    // the prepare task returns PAUSED. The two gates in
    // `EthereumStandardSignAndExecuteTask` guard the Permit2 branch only. So
    // the wallet transport answered reads, never a prompt: no
    // `eth_fillTransaction`, `eth_getTransactionCount` or
    // `eth_sendRawTransaction`.
    expect(walletMethods()).toEqual([
      'eth_chainId',
      'wallet_getCapabilities',
      'eth_chainId',
      'eth_getBlockByNumber',
    ])

    // Pinned as observed, and it looks wrong (in every provider, one unused
    // quote per background pause): the background run fetches a
    // quote and stores its transaction on the step, but never signs it.
    // `EthereumPrepareTransactionTask` re-quotes on every run
    // (`getUpdatedStep`), so the foreground resume quotes again (test 2);
    // core `prepareRestart` also clears the stored request.
    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
    ])
    expect(network.quotes).toHaveLength(1)
    expect(route.steps[0].transactionRequest?.data).toBe(
      network.quotes[0].transactionRequest.data
    )

    expect(actionSequence(page.snapshots)).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
    ])
    // The consumer's route is the live one, left at the prompt.
    expect(route).toBe(page.latest())
    const execution = route.steps[0].execution!
    expect(execution.status).toBe('ACTION_REQUIRED')
    expect(execution.error).toBeUndefined()
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
        status: 'ACTION_REQUIRED',
        txHash: undefined,
        txLink: undefined,
      },
    ])
  })

  it('signs once on the foreground resume and completes', async () => {
    const page = openBackgroundPage()
    await page.run()
    // The background leg quoted once and signed nothing.
    expect(network.quotes).toHaveLength(1)
    expect(network.signed).toEqual([])
    const backgroundEnds = page.snapshots.length

    const route = await page.retry()

    // The resume re-quotes: the background quote is never signed.
    expect(network.quotes).toHaveLength(2)
    const [quoteInBackground, quoteOnResume] = network.quotes
    expect(quoteOnResume.quoteId).not.toBe(quoteInBackground.quoteId)
    expect(network.signed).toHaveLength(1)
    const [swap] = network.signed
    expect(moneyFields(swap)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: DIAMOND_ADDRESS,
      data: quoteOnResume.transactionRequest.data,
      value: FROM_AMOUNT,
    })
    expect(decodeDiamondCall(swap.data!)).toEqual({
      functionName: 'swap',
      args: [quoteOnResume.quoteId, zeroAddress, FROM_AMOUNT, USDC_POLYGON],
    })
    // What reached the node is what the wallet signed, once.
    expect(network.broadcast).toEqual([swap.serialized])
    expect(
      network.rpc
        .filter((call) => call.method === 'eth_sendRawTransaction')
        .map((call) => call.via)
    ).toEqual(['wallet'])
    expect(network.signedMessages).toEqual([])
    expect(page.switches).toEqual([])

    // On chain: the diamond took the value once.
    expect(network.receiptStatus(swap.hash)).toBe('success')
    expect(network.nativeBalanceOf(SOURCE_CHAIN_ID, WALLET_ADDRESS)).toBe(
      START_NATIVE_BALANCE - FROM_AMOUNT
    )

    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
      '/advanced/stepTransaction',
      '/status',
    ])
    expect(network.api[2].query).toEqual({
      fromChain: String(SOURCE_CHAIN_ID),
      fromAddress: WALLET_ADDRESS,
      toChain: String(SOURCE_CHAIN_ID),
      txHash: swap.hash,
      bridge: 'paraswap',
    })

    expect(actionSequence(page.snapshots, 0, backgroundEnds)).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    const execution = route.steps[0].execution!
    expect(execution.status).toBe('DONE')
    expect(execution.error).toBeUndefined()
    expect(execution.toAmount).toBe(RECEIVED_AMOUNT)
    // One SWAP: the paused ACTION_REQUIRED entry is gone (core
    // `prepareRestart`).
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
        txHash: swap.hash,
        txLink: `${EXPLORER_URLS[SOURCE_CHAIN_ID]}tx/${swap.hash}`,
      },
    ])
  })
})
