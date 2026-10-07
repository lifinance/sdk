import { executeRoute } from '@lifi/sdk'
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
  SOLANA_EXPLORER,
  sentTransactions,
  signatureOf,
  submitTrail,
} from './harness.mock.js'

/** The registry's capability probe id (`PROBE_BUNDLE_ID`, private there). */
const PROBE_BUNDLE_ID = '1'.repeat(64)

let network: FakeNetwork
let wallet: FakeWallet

beforeEach(async () => {
  // A plain Solana node first, then a Jito block engine: only the second
  // passes the capability probe.
  network = createFakeNetwork({ read: 'standard', jito: 'jito' })
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

describe('Solana Jito bundle swap', () => {
  it('signs both bundle transactions in one request and submits them once as a bundle', async () => {
    const client = openPage(wallet, {
      rpcUrls: [network.url('read'), network.url('jito')],
      routeOptions: { jitoBundle: true },
    })
    const recorder = recordRoute()

    const route = await executeRoute(
      client,
      buildRoute(network, wallet.address),
      { updateRouteHook: recorder.updateRouteHook }
    )

    // `jitoBundle` reaches the quote request; the API answers with a bundle.
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(network.apiCalls[1].query).toEqual({ jitoBundle: 'true' })
    const bundle = network.quotes[0]
    expect(bundle).toHaveLength(2)

    // One wallet request carries both transactions, in the quoted order.
    expect(wallet.signCalls).toHaveLength(1)
    expect(wallet.signCalls[0]).toMatchObject({
      inputs: bundle,
      rejected: false,
    })
    const signed = wallet.signCalls[0].outputs
    expect(signed).toHaveLength(2)

    // Both read RPCs are probed; only the Jito one submits and confirms. No
    // simulation, and nothing goes out through `sendTransaction`.
    expect(submitTrail(network)).toEqual([
      'getBundleStatuses@read',
      'getBundleStatuses@jito',
      'sendBundle@jito',
      'getBundleStatuses@jito',
      'getSignatureStatuses@jito',
    ])
    expect(
      network.rpcCalls
        .filter((call) => call.method === 'getBundleStatuses')
        .slice(0, 2)
        .map((call) => call.params)
    ).toEqual([[[PROBE_BUNDLE_ID]], [[PROBE_BUNDLE_ID]]])
    expect(sentTransactions(network, 'sendBundle')).toEqual(signed)
    expect(sentTransactions(network)).toEqual([])

    // The bundle's first transaction stands for it.
    const txHash = signatureOf(signed[0])
    expect(network.apiCalls.at(-1)?.query.txHash).toBe(txHash)

    expect(recorder.trail()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(route.steps[0].execution).toMatchObject({
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
  })
})
