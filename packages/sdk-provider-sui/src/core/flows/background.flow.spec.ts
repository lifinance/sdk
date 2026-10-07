import { executeRoute, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  digestOf,
  type FakeSuiNetwork,
  installFakeSuiNetwork,
  openPage,
  recordRouteUpdates,
  STATUS_EXPLORER_URL,
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
    // A call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Sui background execution', () => {
  it('pauses in PrepareTransactionTask without the wallet; a foreground resume signs once and completes', async () => {
    const page = openPage(network)
    const background = recordRouteUpdates()

    const paused = await executeRoute(
      page.client,
      buildRoute('swap', page.walletAddress),
      { executeInBackground: true, updateRouteHook: background.hook }
    )

    // Main pauses in core PrepareTransactionTask (after the quote, before
    // the sign task): SuiSignAndExecuteTask has no interaction check.
    expect(page.signTransaction).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toHaveLength(1)
    expect(network.executed).toEqual([])
    expect(network.methods).toEqual([
      'grpc.listBalances',
      'grpc.ledgerService.getServiceInfo',
    ])
    expect(background.changes).toEqual(['SWAP:STARTED', 'SWAP:ACTION_REQUIRED'])
    expect(stepOf(paused).execution?.status).toBe('ACTION_REQUIRED')

    const stored = background.snapshots.at(-1)
    expect(stored).toBeDefined()
    const foreground = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, stored!, {
      updateRouteHook: foreground.hook,
    })

    // `prepareRestart` drops the quoted transaction, so the resume asks for
    // a new quote and signs that one, once.
    expect(network.stepTransactionRequests).toHaveLength(2)
    expect(signedBytes(page)).toEqual([network.quotes[1]])
    expect(network.executed).toEqual([
      { bytes: network.quotes[1], signatures: await signatures(page) },
    ])
    expect(foreground.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    const execution = stepOf(resumed).execution
    expect(execution?.status).toBe('DONE')
    const digest = digestOf(network.quotes[1])
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        txHash: digest,
        txLink: `${STATUS_EXPLORER_URL}tx/${digest}`,
      }),
    ])
  })
})
