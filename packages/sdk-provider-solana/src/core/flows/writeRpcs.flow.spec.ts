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

let network: FakeNetwork
let wallet: FakeWallet

beforeEach(async () => {
  network = createFakeNetwork({ read: 'standard', write: 'standard' })
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

describe('Solana swap sent through write RPCs', () => {
  it('sends only through the write RPC and reads only from the read RPC', async () => {
    const client = openPage(wallet, {
      rpcUrls: { read: [network.url('read')], write: [network.url('write')] },
    })
    const recorder = recordRoute()

    const route = await executeRoute(
      client,
      buildRoute(network, wallet.address),
      { updateRouteHook: recorder.updateRouteHook }
    )

    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(wallet.signCalls).toHaveLength(1)
    expect(wallet.signCalls[0]).toMatchObject({
      inputs: [network.quotes[0]],
      rejected: false,
    })
    const signed = wallet.signCalls[0].outputs

    // The simulation and the confirmation reads stay on the read RPC; the one
    // send goes to the write RPC.
    expect(submitTrail(network)).toEqual([
      'simulateTransaction@read',
      'sendTransaction@write',
      'getSignatureStatuses@read',
    ])
    expect(sentTransactions(network)).toEqual(signed)
    expect(
      network.rpcCalls
        .filter((call) => call.url === network.url('write'))
        .map((call) => call.method)
    ).toEqual(['sendTransaction'])

    const txHash = signatureOf(signed[0])
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
