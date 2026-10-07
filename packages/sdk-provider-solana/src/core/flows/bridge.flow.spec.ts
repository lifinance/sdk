import { ChainId, executeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateTestKeypair } from '../../utils/KeypairWallet.unit.helpers.js'
import {
  apiTrail,
  buildRoute,
  createFakeNetwork,
  createFakeWallet,
  DESTINATION_TX_HASH,
  ETH_USDC_TOKEN,
  ETHEREUM_EXPLORER,
  type FakeNetwork,
  type FakeWallet,
  openPage,
  RECEIVED_BRIDGE_AMOUNT,
  recordRoute,
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

describe('Solana bridge (Solana to Ethereum)', () => {
  it('sends the source transaction, polls /status to DONE and records the receiving side', async () => {
    const client = openPage(wallet, { rpcUrls: [network.url('read')] })
    const recorder = recordRoute()

    const route = await executeRoute(
      client,
      buildRoute(network, wallet.address, 'bridge'),
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
    expect(signed).toHaveLength(1)
    expect(submitTrail(network)).toEqual([
      'simulateTransaction@read',
      'sendTransaction@read',
      'getSignatureStatuses@read',
    ])
    expect(sentTransactions(network)).toEqual(signed)

    // `/status` is asked for the source hash, with the bridge and both chains.
    const txHash = signatureOf(signed[0])
    expect(network.apiCalls.at(-1)?.query).toMatchObject({
      txHash,
      bridge: 'mayan',
      fromChain: String(ChainId.SOL),
      toChain: String(ChainId.ETH),
    })

    expect(recorder.trail()).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'CROSS_CHAIN:DONE RECEIVING_CHAIN:PENDING',
      'CROSS_CHAIN:DONE RECEIVING_CHAIN:DONE',
    ])
    expect(route.steps[0].execution).toMatchObject({
      status: 'DONE',
      // From the receiving side of the `/status` answer, not the estimate.
      toAmount: RECEIVED_BRIDGE_AMOUNT,
      toToken: { address: ETH_USDC_TOKEN.address, chainId: ChainId.ETH },
      actions: [
        {
          type: 'CROSS_CHAIN',
          status: 'DONE',
          chainId: ChainId.SOL,
          txHash,
          txLink: `${SOLANA_EXPLORER}tx/${txHash}`,
        },
        {
          type: 'RECEIVING_CHAIN',
          status: 'DONE',
          chainId: ChainId.ETH,
          txHash: DESTINATION_TX_HASH,
          txLink: `${ETHEREUM_EXPLORER}tx/${DESTINATION_TX_HASH}`,
        },
      ],
    })
  })
})
