import { executeRoute, LiFiErrorCode, resumeRoute } from '@lifi/sdk'
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

describe('Solana on-chain failure', () => {
  it('fails the step when the transaction lands with an error; "Try again" signs a new transaction', async () => {
    const client = openPage(wallet, { rpcUrls: [network.url('read')] })
    const recorder = recordRoute()
    // The simulation passes; the transaction then lands with an error.
    network.failNext = { InstructionError: [0, { Custom: 1 }] }

    await expect(
      executeRoute(client, buildRoute(network, wallet.address), {
        updateRouteHook: recorder.updateRouteHook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionFailed })

    expect(wallet.signCalls).toHaveLength(1)
    expect(wallet.signCalls[0]).toMatchObject({
      inputs: [network.quotes[0]],
      rejected: false,
    })
    const first = wallet.signCalls[0].outputs
    expect(first).toHaveLength(1)
    expect(submitTrail(network)).toEqual([
      'simulateTransaction@read',
      'sendTransaction@read',
      'getSignatureStatuses@read',
    ])
    expect(sentTransactions(network)).toEqual(first)
    // /status is never asked for a failed transaction.
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
    ])

    const failedHash = signatureOf(first[0])
    expect(recorder.trail()).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    const failed = recorder.latest()
    expect(failed.steps[0].execution).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.TransactionFailed },
      actions: [
        {
          type: 'SWAP',
          status: 'FAILED',
          // The failed action keeps the hash of the transaction that landed.
          txHash: failedHash,
          txLink: `${SOLANA_EXPLORER}tx/${failedHash}`,
          error: {
            code: LiFiErrorCode.TransactionFailed,
            // Looks wrong, pinned as it is: kit turns the numbers of the
            // RPC's `err` into bigints, and `safeStringifyBigInt` writes them
            // as strings. The node said `{"InstructionError":[0,{"Custom":1}]}`.
            message:
              'Transaction failed: {"InstructionError":["0",{"Custom":"1"}]}',
          },
        },
      ],
    })

    // "Try again" on the same page.
    const retry = recordRoute()
    const route = await resumeRoute(client, failed, {
      updateRouteHook: retry.updateRouteHook,
    })

    // `prepareRestart` drops the FAILED action although it has a hash, and
    // clears `transactionRequest`: a new quote and a new signature.
    expect(apiTrail(network)).toEqual([
      'GET /chains',
      'POST /advanced/stepTransaction',
      'POST /advanced/stepTransaction',
      'GET /status',
    ])
    // Fixture precondition: the two quotes differ, so the input pin below
    // tells them apart.
    expect(network.quotes[1]).not.toEqual(network.quotes[0])
    expect(wallet.signCalls).toHaveLength(2)
    expect(wallet.signCalls[1]).toMatchObject({
      inputs: [network.quotes[1]],
      rejected: false,
    })
    const second = wallet.signCalls[1].outputs
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(first[0])
    // Every send of the test: the failed bytes once, then the new bytes.
    expect(sentTransactions(network)).toEqual([...first, ...second])

    const txHash = signatureOf(second[0])
    expect(network.apiCalls.at(-1)?.query.txHash).toBe(txHash)
    expect(retry.trail()).toEqual([
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
