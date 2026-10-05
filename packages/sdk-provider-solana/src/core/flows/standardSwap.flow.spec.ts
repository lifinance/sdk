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
  SOL_USDC_TOKEN,
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
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

describe('Solana standard same-chain swap', () => {
  it('signs the quoted transaction once, sends exactly the signed bytes and completes', async () => {
    const client = openPage(wallet, { rpcUrls: [network.url('read')] })
    const recorder = recordRoute()

    const route = await executeRoute(
      client,
      buildRoute(network, wallet.address),
      { updateRouteHook: recorder.updateRouteHook }
    )

    // One quote, one status read.
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
      'GET /status',
    ])

    // The wallet is asked once, for exactly the quoted bytes.
    expect(wallet.signCalls).toHaveLength(1)
    expect(wallet.signCalls[0]).toMatchObject({
      inputs: [network.quotes[0]],
      rejected: false,
    })
    const signed = wallet.signCalls[0].outputs
    expect(signed).toHaveLength(1)

    // Simulated, sent once to the one read RPC, confirmed on the first read.
    expect(submitTrail(network)).toEqual([
      'simulateTransaction@read',
      'sendTransaction@read',
      'getSignatureStatuses@read',
    ])
    expect(sentTransactions(network)).toEqual(signed)

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
      toToken: { address: SOL_USDC_TOKEN.address },
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
    // What storage holds is the same final state.
    expect(recorder.latest().steps[0].execution?.status).toBe('DONE')
  })
})
