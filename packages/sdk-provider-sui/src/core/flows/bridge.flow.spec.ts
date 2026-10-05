import { ChainId, executeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  ARB_USDC_TOKEN,
  BRIDGE_RECEIVED_AMOUNT,
  buildRoute,
  destinationTxHashOf,
  digestOf,
  type FakeSuiNetwork,
  installFakeSuiNetwork,
  openPage,
  recordRouteUpdates,
  SUI_EXPLORER_URL,
  signatures,
  signedBytes,
  stepOf,
} from './harness.mock.js'

let network: FakeSuiNetwork

beforeEach(() => {
  network = installFakeSuiNetwork()
})

afterEach(() => {
  try {
    // Spec §3.1: a call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Sui bridge (Sui → Arbitrum)', () => {
  it('executes the source transaction once, then polls /status to DONE and records RECEIVING_CHAIN', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('bridge', page.walletAddress)

    const executed = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    })

    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    expect(signedBytes(page)).toEqual(network.quotes)
    expect(network.executed).toEqual([
      { bytes: network.quotes[0], signatures: await signatures(page) },
    ])
    // #507: the SDK signs, then calls executeTransaction itself; no signAndExecuteTransaction (spec §4.6)
    expect(network.methods).toEqual([
      'grpc.listBalances',
      'grpc.ledgerService.getServiceInfo',
      'client.executeTransaction',
      'grpc.waitForTransaction',
    ])
    const digest = digestOf(network.quotes[0])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.SUI),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.ARB),
        txHash: digest,
        bridge: 'mayan',
      },
    ])

    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])
    const execution = stepOf(executed).execution
    expect(execution?.status).toBe('DONE')
    const receivingHash = destinationTxHashOf(digest)
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'CROSS_CHAIN',
        status: 'DONE',
        chainId: ChainId.SUI,
        txHash: digest,
        txLink: `${SUI_EXPLORER_URL}txblock/${digest}`,
      }),
      expect.objectContaining({
        type: 'RECEIVING_CHAIN',
        status: 'DONE',
        chainId: ChainId.ARB,
        substatus: 'COMPLETED',
        txHash: receivingHash,
        txLink: `${ARB_EXPLORER_URL}tx/${receivingHash}`,
      }),
    ])
    // `toAmount` is what `/status` says arrived, not the estimate.
    expect(execution?.toAmount).toBe(BRIDGE_RECEIVED_AMOUNT)
    expect(execution?.toToken).toEqual(ARB_USDC_TOKEN)
  })
})
