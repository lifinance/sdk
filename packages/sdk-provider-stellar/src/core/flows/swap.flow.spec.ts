import { ChainId, executeRoute, type RouteExtended } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  NETWORK_PASSPHRASE,
  openPage,
  recordRouteUpdates,
  STATUS_EXPLORER_URL,
  STELLAR_EXPLORER_URL,
  SWAP_RECEIVED_AMOUNT,
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

describe('Stellar same-chain swap', () => {
  it('signs the quoted envelope once, submits it once and completes through /status', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('swap', page.walletAddress)
    // What storage held when the envelope reached the node.
    let persistedAtSend: RouteExtended | undefined
    network.onSend = () => {
      persistedAtSend = updates.snapshots.at(-1)
    }

    const executed = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    })

    // One quote for this step.
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    // The wallet was asked once, for the envelope the API served.
    expect(page.signTransaction.mock.calls).toEqual([
      [
        network.quotes[0],
        { address: page.walletAddress, networkPassphrase: NETWORK_PASSPHRASE },
      ],
    ])
    // The node received exactly the envelope the wallet signed, once.
    const signed = await signedEnvelopes(page)
    expect(signed).toHaveLength(1)
    expect(network.sent).toEqual(signed)
    const hash = hashOf(network.quotes[0])
    expect(hashOf(signed[0])).toBe(hash)
    expect(network.rpcMethods).toEqual([
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.XLM),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.XLM),
        txHash: hash,
        bridge: 'soroswap',
      },
    ])

    expect(updates.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // StellarSignAndExecuteTask persists the hash and the provider's link
    // before the envelope reaches the node.
    expect(persistedAtSend).toBeDefined()
    expect(actionOf(persistedAtSend!, 'SWAP')).toMatchObject({
      status: 'PENDING',
      txHash: hash,
      txLink: `${STELLAR_EXPLORER_URL}tx/${hash}`,
    })
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    const execution = stepOf(executed).execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        chainId: ChainId.XLM,
        txHash: hash,
        txLink: `${STATUS_EXPLORER_URL}tx/${hash}`,
      }),
    ])
    expect(execution?.toAmount).toBe(SWAP_RECEIVED_AMOUNT)
  })
})
