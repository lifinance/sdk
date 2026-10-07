import { executeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  buildStep,
  type FakeTronNetwork,
  installFakeTronNetwork,
  LIFI_DIAMOND,
  openPage,
  quotedCallOf,
  recordRoute,
  USDT,
  WALLET_ADDRESS,
} from './harness.mock.js'

let network: FakeTronNetwork

beforeEach(() => {
  network = installFakeTronNetwork()
})

afterEach(() => {
  const unknown = [...network.unknown]
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // A request no fake implements turns into an RPC error and can let a path
  // pass for the wrong reason.
  expect(unknown, 'requests no fake implements').toEqual([])
})

/** The TAPOS fields every transaction gets from the fake head block. */
const HEAD_REF_BLOCK = {
  ref_block_bytes: '1d80',
  ref_block_hash: 'abababababababab',
  expiration: 1_760_000_060_000,
  timestamp: 1_760_000_000_000,
}

describe('Tron TRC-20 same-chain swap', () => {
  it('approves the exact amount for the diamond, then signs and broadcasts the swap', async () => {
    const page = openPage()
    const recorder = recordRoute()
    const step = buildStep('trc20-swap')
    const quoted = quotedCallOf(step.transactionRequest?.data)

    const route = await executeRoute(page.client, buildRoute(step), {
      updateRouteHook: recorder.updateRouteHook,
    })

    // Two wallet requests: the approve the node built, then the swap.
    expect(page.wallet.requests).toHaveLength(2)
    const [approve, swap] = page.wallet.requests
    // `approve(diamond, fromAmount)` on USDT with the default 100 TRX fee
    // limit (the quote has no APPROVE gas cost).
    expect(approve.raw_data).toEqual({
      contract: [
        {
          parameter: {
            value: {
              data: '095ea7b3000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000001e8480',
              owner_address: '41fcad0b19bb29d4674531d6f115237e16afce377c',
              contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
            },
            type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
          },
          type: 'TriggerSmartContract',
        },
      ],
      ...HEAD_REF_BLOCK,
      fee_limit: 100_000_000,
    })
    expect(swap.raw_data).toEqual({
      contract: [
        {
          parameter: {
            value: {
              owner_address: '41FCAD0B19BB29D4674531D6F115237E16AFCE377C',
              contract_address: '412222222222222222222222222222222222222222',
              call_value: 0,
              data: quoted.data.toUpperCase(),
              call_token_value: 0,
              token_id: 0,
            },
            type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
          },
          type: 'TriggerSmartContract',
        },
      ],
      fee_limit: 150_000_000,
      data: '',
      ...HEAD_REF_BLOCK,
    })
    // Two broadcasts, byte for byte what the wallet signed, in that order.
    expect(page.wallet.signed).toHaveLength(2)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(network.allowance(USDT.address, WALLET_ADDRESS, LIFI_DIAMOND)).toBe(
      2_000_000n
    )

    // The allowance is read once, before the approve. Pinned as observed, and
    // one thing looks wrong here: the balance read (`balanceOf`) comes after
    // the approval is sent and confirmed, so a wallet without enough USDT
    // pays for the approval before it learns the balance is too low. The
    // TRC-20 reads use a static ABI, so no `wallet/getcontract` request is
    // sent and the balance read starts before the block read.
    expect(network.nodeCalls).toEqual([
      'wallet/triggerconstantcontract allowance(address,address)',
      'wallet/triggersmartcontract approve(address,uint256)',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
      'wallet/triggerconstantcontract balanceOf(address)',
      'wallet/getnowblock',
      'wallet/getblock',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
    ])
    expect(network.apiCalls).toEqual(['GET /status'])

    expect(recorder.transitions()).toEqual([
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
    const [approveHash, swapHash] = page.wallet.signed.map((tx) => tx.txID)
    expect(route.steps[0].execution?.status).toBe('DONE')
    // The approval link is the provider's own (`getTronTxLink`, no `/`
    // before `#`); `/status` never sees the approval.
    expect(actionOf(route, 'SET_ALLOWANCE')).toMatchObject({
      status: 'DONE',
      txHash: approveHash,
      txLink: `https://tronscan.test#/transaction/${approveHash}`,
    })
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(route, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swapHash,
      txLink: `https://tronscan.test/#/transaction/${swapHash}`,
    })
    expect(route.steps[0].execution?.toAmount).toBe('6600000')
  })

  it('skips the approval when the allowance already covers the amount', async () => {
    network.setAllowance(USDT.address, WALLET_ADDRESS, LIFI_DIAMOND, 2_000_000n)
    const page = openPage()
    const recorder = recordRoute()

    const route = await executeRoute(
      page.client,
      buildRoute(buildStep('trc20-swap')),
      { updateRouteHook: recorder.updateRouteHook }
    )

    // Only the swap is signed and sent.
    expect(page.wallet.requests).toHaveLength(1)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(
      network.nodeCalls.filter((call) => call.includes('allowance'))
    ).toEqual(['wallet/triggerconstantcontract allowance(address,address)'])
    expect(recorder.transitions()).toEqual([
      'CHECK_ALLOWANCE:STARTED',
      'CHECK_ALLOWANCE:DONE',
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(actionOf(route, 'SET_ALLOWANCE')).toBeUndefined()
    const swapHash = page.wallet.signed[0].txID
    expect(route.steps[0].execution?.status).toBe('DONE')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(route, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swapHash,
      txLink: `https://tronscan.test/#/transaction/${swapHash}`,
    })
  })
})
