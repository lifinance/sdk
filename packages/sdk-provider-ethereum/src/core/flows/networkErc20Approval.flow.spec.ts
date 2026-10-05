import { encodeFunctionData, erc20Abi } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionSequence,
  buildNetworkRoute,
  buildNetworkStep,
  createFakeNetwork,
  DIAMOND_ADDRESS,
  decodeApprove,
  decodeDiamondCall,
  EXPLORER_URLS,
  type FakeNetwork,
  moneyFields,
  type NetworkPage,
  openNetworkPage,
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
const TO_AMOUNT = '1490000'
/**
 * `receiving.amount` of the fake `/status`. Not the quoted `TO_AMOUNT`, so the
 * final `execution.toAmount` shows that it comes from `/status`.
 */
const RECEIVED_AMOUNT = '1487654'

let network: FakeNetwork

beforeEach(() => {
  // No allowance for the diamond yet: the SDK has to approve first.
  network = createFakeNetwork({ receivedAmount: () => RECEIVED_AMOUNT })
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

/**
 * USDC → USDT on Polygon, on a chain without Permit2 (`network.mock.ts`): the
 * classic lane, approve the diamond, then swap through it.
 */
const openApprovalPage = (): NetworkPage =>
  openNetworkPage({
    network,
    route: buildNetworkRoute([
      buildNetworkStep({
        id: 'erc20-swap',
        fromToken: USDC,
        toToken: USDT,
        fromAmount: FROM_AMOUNT.toString(),
        toAmount: TO_AMOUNT,
        tool: 'paraswap',
      }),
    ]),
  })

describe('EN2 — an ERC-20 swap that needs an approval, through the real viem actions', () => {
  it('approves the diamond for the amount, waits for that receipt, then signs the swap', async () => {
    const page = openApprovalPage()
    await page.run()

    expect(network.signed).toHaveLength(2)
    const [approve, swap] = network.signed
    const [quote] = network.quotes

    // The approval: the source token's `approve(diamond, fromAmount)`, no
    // value, on the source chain.
    expect(moneyFields(approve)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: USDC_POLYGON,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [DIAMOND_ADDRESS, FROM_AMOUNT],
      }),
      value: 0n,
    })
    expect(decodeApprove(approve.data!)).toEqual({
      spender: DIAMOND_ADDRESS,
      amount: FROM_AMOUNT,
    })

    // The swap: exactly the quote's calldata, no value.
    expect(moneyFields(swap)).toEqual({
      chainId: SOURCE_CHAIN_ID,
      to: DIAMOND_ADDRESS,
      data: quote.transactionRequest.data,
      value: 0n,
    })
    expect(decodeDiamondCall(swap.data!)).toEqual({
      functionName: 'swap',
      args: [quote.quoteId, USDC_POLYGON, FROM_AMOUNT, USDT_POLYGON],
    })

    // What reached the node is what the wallet signed, in that order.
    expect(network.broadcast).toEqual([approve.serialized, swap.serialized])
    expect(network.signedMessages).toEqual([])
    expect(page.switches).toEqual([])

    // The approval's receipt is read before the swap is sent.
    const methods = network.rpc.map((call) => call.method)
    const [approveSent, swapSent] = methods.flatMap((method, index) =>
      method === 'eth_sendRawTransaction' ? [index] : []
    )
    const approveReceipt = methods.indexOf(
      'eth_getTransactionReceipt',
      approveSent
    )
    expect(approveReceipt).toBeGreaterThan(approveSent)
    expect(approveReceipt).toBeLessThan(swapSent)

    // Pinned as observed, and it looks wrong (ledger finding F2):
    // `createPipeline` runs `EthereumCheckBalanceTask` after
    // `EthereumSetAllowanceTask`, so the USDC balance (`balanceOf` on the
    // public client; the allowance read goes through the wallet) is read only
    // after the approval is mined. A wallet without enough USDC pays for the
    // approval before the SDK finds out.
    const balanceRead = network.rpc.findIndex(
      (call) => call.via === 'public' && call.method === 'eth_call'
    )
    expect(balanceRead).toBeGreaterThan(approveReceipt)
    expect(balanceRead).toBeLessThan(swapSent)

    // On chain: both mined, and the swap spent exactly what was approved.
    expect(network.receiptStatus(approve.hash)).toBe('success')
    expect(network.receiptStatus(swap.hash)).toBe('success')
    expect(
      network.allowance(USDC_POLYGON, WALLET_ADDRESS, DIAMOND_ADDRESS)
    ).toBe(0n)
    expect(network.balanceOf(USDC_POLYGON, WALLET_ADDRESS)).toBe(
      START_TOKEN_BALANCE - FROM_AMOUNT
    )
  })

  it('tells the consumer the allowance, the approval and the swap, and ends DONE', async () => {
    const page = openApprovalPage()
    const route = await page.run()

    expect(actionSequence(page.snapshots)).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:STARTED',
      'SET_ALLOWANCE:ACTION_REQUIRED',
      'SET_ALLOWANCE:PENDING',
      'SET_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])

    const [approve, swap] = network.signed
    const link = (hash: string) => `${EXPLORER_URLS[SOURCE_CHAIN_ID]}tx/${hash}`
    const execution = route.steps[0].execution!
    expect(execution.status).toBe('DONE')
    expect(execution.toAmount).toBe(RECEIVED_AMOUNT)
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
      // The approval's txHash/txLink come from `EthereumSetAllowanceTask`.
      {
        type: 'SET_ALLOWANCE',
        status: 'DONE',
        txHash: approve.hash,
        txLink: link(approve.hash),
      },
      // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
      {
        type: 'SWAP',
        status: 'DONE',
        txHash: swap.hash,
        txLink: link(swap.hash),
      },
    ])

    expect(network.api.map((call) => call.path)).toEqual([
      '/advanced/stepTransaction',
      '/status',
    ])
    expect(network.api[1].query).toEqual({
      fromChain: String(SOURCE_CHAIN_ID),
      fromAddress: WALLET_ADDRESS,
      toChain: String(SOURCE_CHAIN_ID),
      txHash: swap.hash,
      bridge: 'paraswap',
    })
  })
})
