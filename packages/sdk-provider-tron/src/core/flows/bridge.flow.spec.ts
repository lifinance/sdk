import { executeRoute } from '@lifi/sdk'
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
  try {
    // A request no fake implements, or a throw inside a fake, turns into an
    // RPC error and can let a path pass for the wrong reason.
    expect(network.unknown, 'requests no fake implements').toEqual([])
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

describe('Tron bridge (Tron → Ethereum)', () => {
  it('sends the source transaction, then polls /status to DONE and records the receiving side', async () => {
    const page = openPage()
    const recorder = recordRoute()
    const step = buildStep('bridge')
    const quoted = quotedCallOf(step.transactionRequest?.data)

    const route = await executeRoute(page.client, buildRoute(step), {
      updateRouteHook: recorder.updateRouteHook,
    })

    // One source-chain transaction: the quoted call, with the TRX value.
    expect(page.wallet.requests).toHaveLength(1)
    expect(
      page.wallet.requests[0].raw_data.contract[0].parameter.value
    ).toEqual({
      owner_address: '41FCAD0B19BB29D4674531D6F115237E16AFCE377C',
      contract_address: '412222222222222222222222222222222222222222',
      call_value: 1_000_000,
      data: quoted.data.toUpperCase(),
      call_token_value: 0,
      token_id: 0,
    })
    expect(page.wallet.signed).toHaveLength(1)
    expect(network.broadcasts).toEqual(page.wallet.signed)

    // One `/status` poll: it answers DONE at once.
    const txHash = page.wallet.signed[0].txID
    expect(network.apiCalls).toEqual(['GET /status'])
    expect(network.statusRequests).toEqual([
      {
        fromChain: '728126428',
        fromAddress: WALLET_ADDRESS,
        toChain: '1',
        txHash,
        bridge: 'allbridge',
      },
    ])

    // The bridge action is DONE when the source receipt lands; the
    // destination leg is a separate RECEIVING_CHAIN action.
    expect(recorder.transitions()).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])
    expect(actionOf(route, 'SWAP')).toBeUndefined()
    expect(actionOf(route, 'CROSS_CHAIN')).toMatchObject({
      status: 'DONE',
      chainId: 728126428,
      txHash,
      txLink: `https://tronscan.test#/transaction/${txHash}`,
    })
    expect(actionOf(route, 'RECEIVING_CHAIN')).toMatchObject({
      status: 'DONE',
      chainId: 1,
      substatus: 'COMPLETED',
      txHash: `0x${txHash}`,
      txLink: `https://etherscan.test/tx/0x${txHash}`,
    })
    expect(route.steps[0].execution).toMatchObject({
      status: 'DONE',
      fromAmount: '1000000',
      toAmount: '300000',
      toToken: { chainId: 1, symbol: 'USDC' },
    })
  })
})
