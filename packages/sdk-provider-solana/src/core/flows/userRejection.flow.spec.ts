import { executeRoute, LiFiErrorCode, resumeRoute } from '@lifi/sdk'
import {
  createKeyPairFromBytes,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
} from '@solana/kit'
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
  recordRoute,
  SOLANA_EXPLORER,
  sentTransactions,
  signatureOf,
  submitTrail,
} from './harness.mock.js'

let network: FakeNetwork
let wallet: FakeWallet
let secretKey: string

/**
 * `wire` signed with the wallet's key, computed apart from the wallet:
 * Ed25519 signatures are deterministic, so these are the exact bytes the
 * wallet must return.
 */
const signedWithWalletKey = async (wire: string): Promise<string> => {
  const keyPair = await createKeyPairFromBytes(
    getBase58Encoder().encode(secretKey)
  )
  const transaction = getTransactionDecoder().decode(
    getBase64Encoder().encode(wire)
  )
  return getBase64EncodedWireTransaction(
    await partiallySignTransaction([keyPair], transaction)
  )
}

beforeEach(async () => {
  network = createFakeNetwork({ read: 'standard' })
  vi.stubGlobal('fetch', network.fetch)
  secretKey = (await generateTestKeypair()).secretKey
  wallet = await createFakeWallet(secretKey)
})

afterEach(() => {
  try {
    expect(network.unknown).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Solana user rejection', () => {
  it('fails with SignatureRejected, sends nothing, and "Try again" asks the wallet again', async () => {
    const client = openPage(wallet, { rpcUrls: [network.url('read')] })
    const recorder = recordRoute()
    wallet.rejectNext = 1

    await expect(
      executeRoute(client, buildRoute(network, wallet.address), {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.SignatureRejected })

    // The wallet was asked for the quoted bytes and refused.
    expect(wallet.signCalls).toEqual([
      { inputs: [network.quotes[0]], outputs: [], rejected: true },
    ])
    // Nothing was simulated or sent, and nothing was asked of /status.
    expect(submitTrail(network)).toEqual([])
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
    ])
    expect(recorder.trail()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:FAILED',
    ])
    const failed = recorder.latest()
    expect(failed.steps[0].execution).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
      actions: [
        {
          type: 'SWAP',
          status: 'FAILED',
          error: { code: LiFiErrorCode.SignatureRejected },
        },
      ],
    })
    expect(failed.steps[0].execution?.actions[0].txHash).toBeUndefined()

    // "Try again" on the same page.
    const retry = recordRoute()
    const route = await resumeRoute(client, failed, {
      updateRouteHook: retry.updateRouteHook,
    })

    // main re-quotes on "Try again" (`prepareRestart` clears
    // `transactionRequest`) and asks the wallet again, for the new quote.
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    expect(network.quotes[1]).not.toEqual(network.quotes[0])
    const signed = await signedWithWalletKey(network.quotes[1] as string)
    expect(wallet.signCalls).toEqual([
      { inputs: [network.quotes[0]], outputs: [], rejected: true },
      { inputs: [network.quotes[1]], outputs: [signed], rejected: false },
    ])
    expect(submitTrail(network)).toEqual([
      'simulateTransaction@read',
      'sendTransaction@read',
      'getSignatureStatuses@read',
    ])
    // Only the bytes signed on "Try again" were ever sent.
    expect(sentTransactions(network)).toEqual([signed])

    const txHash = signatureOf(signed)
    expect(retry.trail()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expect(route.steps[0].execution).toMatchObject({
      status: 'DONE',
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
