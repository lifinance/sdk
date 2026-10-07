import { getAddress, type Hash } from 'viem'
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
  USDC_ARBITRUM,
  USDC_POLYGON,
  WALLET_ADDRESS,
} from './network.mock.js'

const FROM_AMOUNT = 1_500_000n
const TO_AMOUNT = '1480000'
/**
 * `receiving.amount` of the fake `/status`. Not the quoted `TO_AMOUNT`, so the
 * final `execution.toAmount` shows that it comes from `/status`.
 */
const RECEIVED_AMOUNT = '1478321'

/**
 * `receiving.txLink` of the fake `/status`. Core builds
 * `${blockExplorerUrls[0]}tx/<hash>` only when `/status` gives no link, so a
 * link on another host shows which of the two the final action carries.
 */
const statusLinkOf = (hash: Hash): string =>
  `https://explorer.status.test/arbitrum/tx/${hash}`

let network: FakeNetwork

/** Enough allowance already: this spec is about the bridge leg. */
const installNetwork = (receivingChainId?: number): void => {
  network = createFakeNetwork({
    allowances: [{ token: USDC_POLYGON, amount: 10n ** 12n }],
    receivedAmount: () => RECEIVED_AMOUNT,
    receivingTxLink: statusLinkOf,
    ...(receivingChainId !== undefined && { receivingChainId }),
  })
  vi.stubGlobal('fetch', network.fetch)
}

beforeEach(() => {
  installNetwork()
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

/** USDC on Polygon → USDC on Arbitrum. */
const openBridgePage = (): NetworkPage =>
  openNetworkPage({
    network,
    route: buildNetworkRoute([
      buildNetworkStep({
        id: 'bridge',
        fromToken: USDC,
        toToken: USDC_ARB,
        fromAmount: FROM_AMOUNT.toString(),
        toAmount: TO_AMOUNT,
        tool: 'stargate',
      }),
    ]),
  })

describe('a bridge: source transaction, /status to DONE, RECEIVING_CHAIN', () => {
  it('signs one bridge transaction on the source chain and switches nothing', async () => {
    const page = openBridgePage()
    await page.run()

    const [quote] = network.quotes
    expect(network.signed).toHaveLength(1)
    const [bridge] = network.signed
    expect(moneyFields(bridge)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: DIAMOND_ADDRESS,
      data: quote.transactionRequest.data,
      value: 0n,
    })
    expect(decodeDiamondCall(bridge.data!)).toEqual({
      functionName: 'bridge',
      args: [
        quote.quoteId,
        USDC_POLYGON,
        FROM_AMOUNT,
        BigInt(DESTINATION_CHAIN_ID),
      ],
    })
    expect(network.broadcast).toEqual([bridge.serialized])
    expect(network.signedMessages).toEqual([])
    expect(network.receiptStatus(bridge.hash)).toBe('success')
    expect(page.switches).toEqual([])
    // Nothing reaches the destination chain's RPC: the receiving leg is
    // known only from /status.
    expect(
      network.rpc.filter((call) => call.chainId === DESTINATION_CHAIN_ID)
    ).toEqual([])
  })

  it('polls /status for the source hash, adds RECEIVING_CHAIN and ends DONE', async () => {
    const page = openBridgePage()
    const route = await page.run()

    const sourceHash = network.signed[0].hash
    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
      '/status',
    ])
    expect(network.api[1].query).toEqual({
      fromChain: String(SOURCE_CHAIN_ID),
      fromAddress: WALLET_ADDRESS,
      toChain: String(DESTINATION_CHAIN_ID),
      txHash: sourceHash,
      bridge: 'stargate',
    })

    expect(actionSequence(page.snapshots)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])

    const destinationHash = destinationHashOf(sourceHash)
    const execution = route.steps[0].execution!
    expect(execution.status).toBe('DONE')
    expect(execution.toAmount).toBe(RECEIVED_AMOUNT)
    expect(getAddress(execution.toToken!.address)).toBe(USDC_ARBITRUM)
    expect(
      execution.actions.map(({ type, status, chainId, txHash, txLink }) => ({
        type,
        status,
        chainId,
        txHash,
        txLink,
      }))
    ).toEqual([
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
        txHash: sourceHash,
        txLink: `${EXPLORER_URLS[SOURCE_CHAIN_ID]}tx/${sourceHash}`,
      },
      // Core WaitForTransactionStatusTask copies receiving.txHash and
      // receiving.txLink from /status; its fallback would be
      // `${EXPLORER_URLS[DESTINATION_CHAIN_ID]}tx/${destinationHash}`.
      {
        type: 'RECEIVING_CHAIN',
        status: 'DONE',
        chainId: DESTINATION_CHAIN_ID,
        txHash: destinationHash,
        txLink: statusLinkOf(destinationHash),
      },
    ])
  })

  it('takes the final receiving chainId from /status, not from the step', async () => {
    // A real /status answer names the step's toChainId. This one names
    // another chain only to show where each value comes from.
    const otherChainId = 10
    installNetwork(otherChainId)
    const page = openBridgePage()
    const route = await page.run()

    // The PENDING action is opened on the step's toChainId ...
    const pending = page.snapshots
      .flatMap((snapshot) => snapshot.steps[0].execution?.actions ?? [])
      .find(
        (action) =>
          action.type === 'RECEIVING_CHAIN' && action.status === 'PENDING'
      )
    expect(pending?.chainId).toBe(DESTINATION_CHAIN_ID)
    // ... and the DONE action carries the chain that /status names.
    const receiving = route.steps[0].execution!.actions.find(
      (action) => action.type === 'RECEIVING_CHAIN'
    )
    expect(receiving?.status).toBe('DONE')
    expect(receiving?.chainId).toBe(otherChainId)
  })
})
