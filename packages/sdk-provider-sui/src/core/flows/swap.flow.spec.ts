import { ChainId, executeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  digestOf,
  type FakeSuiNetwork,
  installFakeSuiNetwork,
  openPage,
  recordRouteUpdates,
  STATUS_EXPLORER_URL,
  SUI_EXPLORER_URL,
  SWAP_RECEIVED_AMOUNT,
  signatures,
  signedBytes,
  stepOf,
} from './harness.mock.js'

let network: FakeSuiNetwork

beforeEach(() => {
  network = installFakeSuiNetwork()
})

afterEach(() => {
  // Spec §3.1: a call or request the fakes do not know fails the spec.
  expect(network.unexpected).toEqual([])
  vi.unstubAllGlobals()
})

describe('Sui same-chain swap', () => {
  it('signs the quoted bytes once, executes them once and completes through /status', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('swap', page.walletAddress)

    const executed = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    })

    // One quote for this step.
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    // The wallet signed exactly the bytes the API served, once.
    expect(signedBytes(page)).toEqual(network.quotes)
    // The node executed those bytes once, with the wallet's signature.
    expect(network.executed).toEqual([
      { bytes: network.quotes[0], signatures: await signatures(page) },
    ])
    expect(network.methods).toEqual([
      'grpc.listBalances',
      'grpc.ledgerService.getServiceInfo',
      'client.signAndExecuteTransaction',
      'client.executeTransaction',
      'grpc.waitForTransaction',
    ])
    const digest = digestOf(network.quotes[0])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.SUI),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.SUI),
        txHash: digest,
        bridge: 'cetus',
      },
    ])

    expect(updates.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // SuiWaitForTransactionTask sets the provider's link...
    const confirmed = updates.snapshots.find(
      (snapshot) => stepOf(snapshot).execution?.actions[0]?.txHash
    )
    expect(stepOf(confirmed!).execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'PENDING',
        txHash: digest,
        txLink: `${SUI_EXPLORER_URL}txblock/${digest}`,
      }),
    ])
    // ...then:
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    // (same-chain: the `/status` receiving hash is the digest).
    const execution = stepOf(executed).execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        chainId: ChainId.SUI,
        txHash: digest,
        txLink: `${STATUS_EXPLORER_URL}tx/${digest}`,
      }),
    ])
    expect(execution?.toAmount).toBe(SWAP_RECEIVED_AMOUNT)
  })
})
