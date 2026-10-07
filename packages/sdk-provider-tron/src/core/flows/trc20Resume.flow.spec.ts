import { executeRoute, type RouteExtended, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  buildStep,
  type FakeTronNetwork,
  installFakeTronNetwork,
  openPage,
  quotedCallOf,
  recordRoute,
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

// A Tron TRC-20 resume. A reload is a JSON copy of what `updateRouteHook`
// wrote and a new page (wallet, provider, client, empty TronWeb cache).
describe('Tron TRC-20 swap resume after a reload', () => {
  it('skips the allowance check, waits for the broadcast swap and never signs again', async () => {
    const page = openPage()
    const recorder = recordRoute()
    const step = buildStep('trc20-swap')
    const quoted = quotedCallOf(step.transactionRequest?.data)
    await executeRoute(page.client, buildRoute(step), {
      updateRouteHook: recorder.updateRouteHook,
    })

    // The first run: the approve the node built, then the quoted swap, both
    // re-anchored to the fake head block.
    expect(page.wallet.requests).toHaveLength(2)
    const [approveRequest, swapRequest] = page.wallet.requests
    expect(approveRequest.raw_data).toEqual({
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
    expect(swapRequest.raw_data).toEqual({
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
    const [approve, swap] = page.wallet.signed

    // What storage held right after the swap broadcast: the approval is
    // DONE, the swap is PENDING with its hash.
    const afterBroadcast = recorder.snapshots.find((snapshot) => {
      const action = actionOf(snapshot, 'SWAP')
      return !!action?.txHash && action.status !== 'DONE'
    }) as RouteExtended
    expect(afterBroadcast).toBeDefined()
    expect(actionOf(afterBroadcast, 'SET_ALLOWANCE')).toMatchObject({
      status: 'DONE',
      txHash: approve.txID,
    })
    // #507 behaviour: the sign task stores the signed swap JSON in `txHex`;
    // the broadcast adds `txHash` and keeps `txHex` until the confirmation.
    const storedSwap = actionOf(afterBroadcast, 'SWAP')
    expect(storedSwap).toMatchObject({
      status: 'PENDING',
      txHash: swap.txID,
      txLink: `https://tronscan.test#/transaction/${swap.txID}`,
    })
    expect(storedSwap?.txHex).toBe(JSON.stringify(swap))

    const mark = {
      nodeCalls: network.nodeCalls.length,
      apiCalls: network.apiCalls.length,
      broadcasts: network.broadcasts.length,
      statusRequests: network.statusRequests.length,
    }
    const reloaded = openPage()
    const resume = recordRoute()
    const resumed = await resumeRoute(reloaded.client, afterBroadcast, {
      updateRouteHook: resume.updateRouteHook,
    })

    // #507 behaviour: a broadcast swap that is not DONE is waited for by its
    // hash; no signature and no new quote.
    expect(reloaded.wallet.requests).toEqual([])
    expect(network.apiCalls.slice(mark.apiCalls)).toEqual(['GET /status'])
    // #507 behaviour: the open swap skips the allowance check, so the resume
    // starts at `TronWaitForTransactionTask`: no allowance read, no approve.
    // The dropped check runs first: it reads the head and asks the full node.
    // With a stored transaction, #507 sends this lookup on every resume; only
    // the "not found" verdict needs a head past the expiry. Here the full
    // node returns the landed swap, so the lookup finds it and the swap is
    // not dropped. Then the stored swap is sent again, the node answers
    // DUP_TRANSACTION_ERROR (success), and the receipt is read.
    expect(network.nodeCalls.slice(mark.nodeCalls)).toEqual([
      'wallet/getnowblock',
      'wallet/gettransactioninfobyid',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
    ])
    // #507 behaviour: the resend is exactly the stored `txHex`.
    expect(network.broadcasts.slice(mark.broadcasts)).toEqual([
      JSON.parse(storedSwap?.txHex ?? ''),
    ])
    expect(network.broadcasts.slice(mark.broadcasts)).toEqual([swap])
    expect(network.statusRequests.slice(mark.statusRequests)).toEqual([
      {
        fromChain: '728126428',
        fromAddress: WALLET_ADDRESS,
        toChain: '728126428',
        txHash: swap.txID,
        bridge: 'sunswap',
      },
    ])
    expect(resume.transitions()).toEqual([
      'CHECK_ALLOWANCE:DONE',
      'SET_ALLOWANCE:DONE',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // #507 behaviour: `txHex` is cleared on confirmation, so storage no
    // longer holds the signed bytes.
    const storedAfterResume = actionOf(resume.last(), 'SWAP')
    expect(storedAfterResume).toBeDefined()
    expect(Object.hasOwn(storedAfterResume ?? {}, 'txHex')).toBe(false)
    expect(actionOf(resumed, 'SWAP')?.txHex).toBeUndefined()

    expect(resumed.steps[0].execution?.status).toBe('DONE')
    expect(actionOf(resumed, 'SET_ALLOWANCE')).toMatchObject({
      status: 'DONE',
      txHash: approve.txID,
      txLink: `https://tronscan.test#/transaction/${approve.txID}`,
    })
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(resumed, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: swap.txID,
      txLink: `https://tronscan.test/#/transaction/${swap.txID}`,
    })
    expect(resumed.steps[0].execution?.toAmount).toBe('6600000')
  })
})
