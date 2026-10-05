import { executeRoute, getActiveRoute, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateTestKeypair } from '../../utils/KeypairWallet.unit.helpers.js'
import {
  apiTrail,
  buildRoute,
  createFakeNetwork,
  createFakeWallet,
  type FakeNetwork,
  type FakeWallet,
  openPage,
  RECEIVED_SWAP_AMOUNT,
  recordRoute,
  rpcTrail,
  SOLANA_EXPLORER,
  sentTransactions,
  signatureOf,
  submitTrail,
} from './harness.mock.js'

let network: FakeNetwork
let wallet: FakeWallet

beforeEach(async () => {
  network = createFakeNetwork({ read: 'standard' })
  vi.stubGlobal('fetch', network.fetch)
  wallet = await createFakeWallet((await generateTestKeypair()).secretKey)
})

afterEach(() => {
  try {
    expect(network.unknown).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Solana background execution', () => {
  it('pauses before the wallet in the background; a foreground resume signs once and completes', async () => {
    const client = openPage(wallet, { rpcUrls: [network.url('read')] })
    const recorder = recordRoute()
    const route = buildRoute(network, wallet.address)

    // Resolves, it does not throw.
    const paused = await executeRoute(client, route, {
      updateRouteHook: recorder.updateRouteHook,
      executeInBackground: true,
    })

    // main pauses in core `PrepareTransactionTask`, after the balance check
    // and AFTER it fetched the quote: the Solana sign task has no
    // `allowUserInteraction` check of its own.
    expect(wallet.signCalls).toEqual([])
    expect(sentTransactions(network)).toEqual([])
    expect(submitTrail(network)).toEqual([])
    // Only the reads of the balance check (`getSolanaBalance`) reached a node.
    // It sends them together, so the order is not pinned.
    expect(rpcTrail(network).sort()).toEqual([
      'getBalance@read',
      'getSlot@read',
      'getTokenAccountsByOwner@read',
      'getTokenAccountsByOwner@read',
    ])
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
    ])
    expect(recorder.trail()).toEqual(['SWAP:STARTED', 'SWAP:ACTION_REQUIRED'])
    expect(paused.steps[0].execution).toMatchObject({
      status: 'ACTION_REQUIRED',
      actions: [{ type: 'SWAP', status: 'ACTION_REQUIRED' }],
    })
    const stored = recorder.latest()
    expect(stored.steps[0].execution?.status).toBe('ACTION_REQUIRED')
    // main: storage holds the quote the background run fetched; the resume
    // below drops it and never signs it (finding).
    expect(stored.steps[0].transactionRequest?.data).toBe(network.quotes[0])
    // The paused run is stopped, not parked: nothing is active any more.
    expect(getActiveRoute(route.id)).toBeUndefined()

    // Foreground resume of what storage holds.
    const resume = recordRoute()
    const done = await resumeRoute(client, recorder.latest(), {
      updateRouteHook: resume.updateRouteHook,
    })

    // The resume goes through `prepareRestart`, which clears
    // `transactionRequest`: main fetches a second quote and signs that one.
    // The first quote is never signed.
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    // Fixture precondition: the two quotes differ, so the input pin below
    // tells them apart.
    expect(network.quotes[1]).not.toEqual(network.quotes[0])
    expect(wallet.signCalls).toHaveLength(1)
    expect(wallet.signCalls[0]).toMatchObject({
      inputs: [network.quotes[1]],
      rejected: false,
    })
    const signed = wallet.signCalls[0].outputs
    expect(signed).toHaveLength(1)
    expect(submitTrail(network)).toEqual([
      'simulateTransaction@read',
      'sendTransaction@read',
      'getSignatureStatuses@read',
    ])
    // Every send of the test: only the bytes the resume signed.
    expect(sentTransactions(network)).toEqual(signed)

    const txHash = signatureOf(signed[0])
    expect(network.apiCalls.at(-1)?.query.txHash).toBe(txHash)
    expect(resume.trail()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(done.steps[0].execution).toMatchObject({
      status: 'DONE',
      toAmount: RECEIVED_SWAP_AMOUNT,
      actions: [
        {
          type: 'SWAP',
          status: 'DONE',
          // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
          txHash,
          txLink: `${SOLANA_EXPLORER}tx/${txHash}`,
        },
      ],
    })
    expect(resume.latest().steps[0].execution?.status).toBe('DONE')
    expect(getActiveRoute(route.id)).toBeUndefined()
  })
})
