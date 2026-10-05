import { executeRoute } from '@lifi/sdk'
import { Trx } from 'tronweb'
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

describe('Tron TRX same-chain swap', () => {
  it('signs the quoted call once, broadcasts exactly that transaction and completes', async () => {
    const page = openPage()
    const recorder = recordRoute()
    const step = buildStep('trx-swap')
    const quoted = quotedCallOf(step.transactionRequest?.data)

    const route = await executeRoute(page.client, buildRoute(step), {
      updateRouteHook: recorder.updateRouteHook,
    })

    // The wallet signs the quoted call once. `TronSignAndExecuteTask`
    // re-anchors it to the head block (the quote carried ref block `0001`)
    // and re-encodes it through TronWeb's deserializer, which upper-cases the
    // hex fields and adds the zero token fields.
    expect(page.wallet.requests).toHaveLength(1)
    expect(page.wallet.requests[0].raw_data).toEqual({
      contract: [
        {
          parameter: {
            value: {
              owner_address: '41FCAD0B19BB29D4674531D6F115237E16AFCE377C',
              contract_address: '412222222222222222222222222222222222222222',
              call_value: 1_000_000,
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
      ref_block_bytes: '1d80',
      ref_block_hash: 'abababababababab',
      expiration: 1_760_000_060_000,
      timestamp: 1_760_000_000_000,
    })
    // One broadcast, byte for byte what the wallet signed, with a real
    // signature of the wallet key.
    expect(page.wallet.signed).toHaveLength(1)
    expect(network.broadcasts).toEqual(page.wallet.signed)
    expect(Trx.ecRecover(network.broadcasts[0] as never)).toBe(WALLET_ADDRESS)

    // Every node read on this path, in order: the TRX balance
    // (`CheckBalanceTask`), the ref block (`TronSignAndExecuteTask`), the
    // broadcast and one receipt read that already finds the transaction.
    expect(network.nodeCalls).toEqual([
      'walletsolidity/getaccount',
      'wallet/getnowblock',
      'wallet/getblock',
      'wallet/broadcasttransaction',
      'walletsolidity/gettransactioninfobyid',
    ])
    const txHash = page.wallet.signed[0].txID
    expect(network.apiCalls).toEqual(['GET /status'])
    expect(network.statusRequests).toEqual([
      {
        fromChain: '728126428',
        fromAddress: WALLET_ADDRESS,
        toChain: '728126428',
        txHash,
        bridge: 'sunswap',
      },
    ])

    expect(recorder.transitions()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // After the broadcast the action carries the provider's own link.
    const afterBroadcast = recorder.snapshots.find(
      (snapshot) => actionOf(snapshot, 'SWAP')?.txHash
    )
    expect(actionOf(afterBroadcast!, 'SWAP')).toMatchObject({
      status: 'PENDING',
      txHash,
      txLink: `https://tronscan.test#/transaction/${txHash}`,
    })
    expect(route.steps[0].execution?.status).toBe('DONE')
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    expect(actionOf(route, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash,
      txLink: `https://tronscan.test/#/transaction/${txHash}`,
    })
    expect(route.steps[0].execution?.toAmount).toBe('300000')
    expect(recorder.last().steps[0].execution?.status).toBe('DONE')
  })
})
