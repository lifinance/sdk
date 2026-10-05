import { ChainId, executeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  BRIDGE_RECEIVED_AMOUNT,
  BRIDGE_TO_ADDRESS,
  buildRoute,
  destinationTxHashOf,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  NETWORK_PASSPHRASE,
  openPage,
  recordRouteUpdates,
  STELLAR_EXPLORER_URL,
  signedEnvelopes,
  stepOf,
} from './harness.mock.js'

let network: FakeStellarNetwork

beforeEach(() => {
  network = installFakeStellarNetwork()
})

afterEach(() => {
  try {
    // Spec §3.1: a call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Stellar bridge (cross-chain step)', () => {
  it('submits the source transaction once, then polls /status to DONE and completes RECEIVING_CHAIN', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('bridge', page.walletAddress)

    const executed = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    })

    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    expect(page.signTransaction.mock.calls).toEqual([
      [
        network.quotes[0],
        { address: page.walletAddress, networkPassphrase: NETWORK_PASSPHRASE },
      ],
    ])
    const signed = await signedEnvelopes(page)
    expect(signed).toHaveLength(1)
    expect(network.sent).toEqual(signed)
    const hash = hashOf(network.quotes[0])
    expect(network.rpcMethods).toEqual([
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    // The status poll names the bridge and the destination chain.
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.XLM),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.ARB),
        txHash: hash,
        bridge: 'allbridge',
      },
    ])

    // StellarWaitForTransactionTask marks CROSS_CHAIN DONE on confirmation;
    // WaitForTransactionStatusTask then opens RECEIVING_CHAIN.
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
    const destinationHash = destinationTxHashOf(hash)
    expect(execution?.actions).toEqual([
      // The source action keeps the provider's link.
      expect.objectContaining({
        type: 'CROSS_CHAIN',
        status: 'DONE',
        chainId: ChainId.XLM,
        txHash: hash,
        txLink: `${STELLAR_EXPLORER_URL}tx/${hash}`,
      }),
      expect.objectContaining({
        type: 'RECEIVING_CHAIN',
        status: 'DONE',
        chainId: ChainId.ARB,
        substatus: 'COMPLETED',
        txHash: destinationHash,
        txLink: `${ARB_EXPLORER_URL}tx/${destinationHash}`,
      }),
    ])
    expect(execution?.toAmount).toBe(BRIDGE_RECEIVED_AMOUNT)
    expect(stepOf(executed).action.toAddress).toBe(BRIDGE_TO_ADDRESS)
  })
})
