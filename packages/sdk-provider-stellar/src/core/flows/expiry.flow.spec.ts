import { executeRoute, LiFiErrorCode, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  openPage,
  recordRouteUpdates,
  signedEnvelopes,
  stepOf,
} from './harness.mock.js'

let network: FakeStellarNetwork

beforeEach(() => {
  network = installFakeStellarNetwork()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_800_000_000_000)
})

afterEach(() => {
  try {
    expect(network.unexpected).toEqual([])
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

describe('Stellar prepared envelope expiry', () => {
  it('rejects expiry during a request hook before signing, then resumes with a fresh envelope', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('swap', page.walletAddress)

    await expect(
      executeRoute(page.client, route, {
        updateRouteHook: updates.hook,
        updateTransactionRequestHook: async (request) => {
          // The API returned a prepared envelope with a 300 s lifetime.
          vi.setSystemTime(Date.now() + 301_000)
          return request
        },
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionExpired })

    expect(page.signTransaction).not.toHaveBeenCalled()
    expect(network.sent).toEqual([])
    expect(network.statusRequests).toEqual([])
    expect(network.quotes).toHaveLength(1)
    const failed = updates.snapshots.at(-1)!
    const failedAction = actionOf(failed, 'SWAP')
    expect(failedAction).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.TransactionExpired },
    })
    expect(failedAction?.txHash).toBeUndefined()
    expect(failedAction?.txHex).toBeUndefined()
    expect(failedAction?.txFinal).toBeUndefined()

    const resumed = await resumeRoute(page.client, failed)

    expect(network.quotes).toHaveLength(2)
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    expect(page.signTransaction.mock.calls[0][0]).toBe(network.quotes[1])
    expect(network.sent).toEqual(await signedEnvelopes(page))
    expect(network.sent).toHaveLength(1)
    expect(actionOf(resumed, 'SWAP')).toMatchObject({
      status: 'DONE',
      txHash: hashOf(network.quotes[1]),
    })
    expect(stepOf(resumed).execution?.status).toBe('DONE')
  })
})
