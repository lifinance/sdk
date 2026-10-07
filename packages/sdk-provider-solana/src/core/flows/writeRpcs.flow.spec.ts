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
  network = createFakeNetwork({
    read: 'standard',
    write: 'standard',
    write2: 'standard',
  })
  vi.stubGlobal('fetch', network.fetch)
  wallet = await createFakeWallet((await generateTestKeypair()).secretKey)
})

/** The JSON-RPC methods the node `name` received, in order. */
const methodsOn = (name: string): string[] =>
  network.rpcCalls
    .filter((call) => call.url === network.url(name))
    .map((call) => call.method)

/** The wire transactions the node `name` received through `sendTransaction`. */
const sentTo = (name: string): string[] =>
  network.rpcCalls
    .filter(
      (call) =>
        call.url === network.url(name) && call.method === 'sendTransaction'
    )
    .map((call) => call.params[0] as string)

afterEach(() => {
  try {
    expect(network.unknown).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Solana swap sent through write RPCs', () => {
  it('sends through every write RPC and reads only from the read RPC', async () => {
    const client = openPage(wallet, {
      rpcUrls: {
        read: [network.url('read')],
        write: [network.url('write'), network.url('write2')],
      },
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

    // The simulation and the confirmation read stay on the read RPC, which
    // gets no send.
    expect(
      submitTrail(network).filter((entry) => entry.endsWith('@read'))
    ).toEqual(['simulateTransaction@read', 'getSignatureStatuses@read'])
    // Each write RPC gets the one send and nothing else. The sends to the
    // write RPCs run at the same time, so the order across nodes is not
    // pinned.
    expect(methodsOn('write')).toEqual(['sendTransaction'])
    expect(methodsOn('write2')).toEqual(['sendTransaction'])
    expect(sentTo('write')).toEqual([signed[0]])
    expect(sentTo('write2')).toEqual([signed[0]])
    expect(sentTransactions(network)).toEqual([signed[0], signed[0]])

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
