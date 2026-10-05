import { ChainId, executeRoute, LiFiErrorCode, resumeRoute } from '@lifi/sdk'
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
  rejectNextSignature,
  STATUS_EXPLORER_URL,
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

describe('Stellar user rejection', () => {
  it('fails the step with SignatureRejected, sends nothing, and "Try again" asks the wallet again', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('swap', page.walletAddress)
    const signOptions = {
      address: page.walletAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    }
    rejectNextSignature(page)

    await expect(
      executeRoute(page.client, route, {
        updateRouteHook: updates.hook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.SignatureRejected })

    // The wallet was asked once, for the envelope the API served.
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[0], signOptions],
    ])
    // Nothing reached the node.
    expect(network.sent).toEqual([])
    expect(network.rpcMethods).toEqual(['simulateTransaction'])
    expect(network.statusRequests).toEqual([])
    expect(updates.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:FAILED',
    ])
    // What storage holds: the step failed, without a transaction. (On main,
    // resumeRoute changes the route it gets, so these pins come first.)
    const failed = updates.snapshots.at(-1)
    expect(failed).toBeDefined()
    expect(stepOf(failed!).execution?.status).toBe('FAILED')
    expect(actionOf(failed!, 'SWAP')).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
    })
    expect(actionOf(failed!, 'SWAP')?.txHash).toBeUndefined()

    // "Try again": a new quote, a new signature request, one submission.
    const retry = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, failed!, {
      updateRouteHook: retry.hook,
    })

    expect(network.quotes).toHaveLength(2)
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
      route.steps[0].id,
    ])
    // The wallet was asked again, for the new envelope.
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[0], signOptions],
      [network.quotes[1], signOptions],
    ])
    // The node received exactly the envelope the wallet signed, once.
    const signed = await signedEnvelopes(page)
    expect(network.sent).toEqual(signed)
    const hash = hashOf(network.quotes[1])
    expect(signed.map(hashOf)).toEqual([hash])
    expect(network.rpcMethods).toEqual([
      // The rejected run: CheckBalanceTask (SAC balance).
      'simulateTransaction',
      // "Try again": CheckBalanceTask again, then the submission.
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
    expect(retry.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    const execution = stepOf(resumed).execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.error).toBeUndefined()
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        chainId: ChainId.XLM,
        txHash: hash,
        txLink: `${STATUS_EXPLORER_URL}tx/${hash}`,
      }),
    ])
    expect(actionOf(resumed, 'SWAP')?.error).toBeUndefined()
    expect(execution?.toAmount).toBe(SWAP_RECEIVED_AMOUNT)
  })
})
