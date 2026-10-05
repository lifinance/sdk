import { ChainId, executeRoute, LiFiErrorCode, resumeRoute } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  envelopeFieldsOf,
  envelopesToSign,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  NETWORK_PASSPHRASE,
  openPage,
  ROUTER_CONTRACT,
  recordRouteUpdates,
  STARTING_SEQUENCE,
  STATUS_EXPLORER_URL,
  STELLAR_EXPLORER_URL,
  SWAP_RECEIVED_AMOUNT,
  sequenceOf,
  signedEnvelopes,
  stepOf,
  XLM_FROM_AMOUNT,
} from './harness.mock.js'

let network: FakeStellarNetwork

beforeEach(() => {
  network = installFakeStellarNetwork()
})

afterEach(() => {
  try {
    // Spec §3.1: a call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * Every field of a quoted swap envelope that the backend (the fake API)
 * chooses, as `envelopeFieldsOf` decodes it. The SDK signs the quote as
 * it is, so the signed envelope has the same fields.
 */
const quotedSwapFields = (
  source: string,
  sequence: bigint,
  quoteNumber: number,
  builtFrom: number,
  builtTo: number
) => {
  const args = [source, BigInt(XLM_FROM_AMOUNT), quoteNumber]
  return {
    source,
    fee: '1000000',
    sequence: String(sequence),
    preconditions: 'precondTime',
    timeBounds: {
      minTime: 0,
      maxTime: expect.toSatisfy(
        (maxTime: number) =>
          maxTime >= builtFrom + 300 && maxTime <= builtTo + 300,
        'maxTime is 300 s after the quote'
      ),
    },
    memo: 'none',
    operations: [
      {
        type: 'invokeHostFunction',
        source: null,
        contract: ROUTER_CONTRACT,
        method: 'swap',
        args,
        argTypes: ['scvAddress', 'scvI128', 'scvU32'],
        auth: [],
      },
    ],
    sorobanData: {
      resourceFee: 0n,
      instructions: 0,
      diskReadBytes: 0,
      writeBytes: 0,
      readOnly: [],
      readWrite: [],
      ext: 'v0',
    },
  }
}

describe('Stellar on-chain failure', () => {
  it('fails the step when getTransaction reports FAILED, and "Try again" signs a new transaction', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    const route = buildRoute('swap', page.walletAddress)
    const signOptions = {
      address: page.walletAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    }
    network.failNextLanding = true

    const firstFrom = nowSeconds()
    const error = await executeRoute(page.client, route, {
      updateRouteHook: updates.hook,
    }).catch((e: unknown) => e)
    const firstTo = nowSeconds()
    expect(error).toMatchObject({ code: LiFiErrorCode.TransactionFailed })

    const first = hashOf(network.quotes[0])
    expect(network.landed.get(first)?.status).toBe('FAILED')
    // One quote, one signature request for it.
    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
    ])
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[0], signOptions],
    ])
    expect(envelopesToSign(page)).toEqual([network.quotes[0]])
    // The node received exactly the envelope the wallet signed, once.
    const signedFirst = await signedEnvelopes(page)
    expect(network.sent).toEqual(signedFirst)
    expect(signedFirst.map(hashOf)).toEqual([first])
    expect(network.rpcMethods).toEqual([
      // CheckBalanceTask: SAC balance.
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    // The ledger's verdict is final: no `/status` poll.
    expect(network.statusRequests).toEqual([])
    expect(updates.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    // What storage holds: the step failed, and the action keeps the hash
    // and the provider's link. (On main, resumeRoute changes the route it
    // gets, so these pins come first.)
    const failed = updates.snapshots.at(-1)
    expect(failed).toBeDefined()
    expect(stepOf(failed!).execution?.status).toBe('FAILED')
    expect(actionOf(failed!, 'SWAP')).toMatchObject({
      status: 'FAILED',
      txHash: first,
      txLink: `${STELLAR_EXPLORER_URL}tx/${first}`,
      error: { code: LiFiErrorCode.TransactionFailed },
    })

    // "Try again": prepareRestart drops the FAILED action with its hash, so
    // the step starts over with a new quote and a new signature.
    const retry = recordRouteUpdates()
    const retryFrom = nowSeconds()
    const resumed = await resumeRoute(page.client, failed!, {
      updateRouteHook: retry.hook,
    })
    const retryTo = nowSeconds()

    expect(network.stepTransactionRequests.map((step) => step.id)).toEqual([
      route.steps[0].id,
      route.steps[0].id,
    ])
    expect(network.quotes).toHaveLength(2)
    const second = hashOf(network.quotes[1])
    expect(second).not.toBe(first)
    // The failed transaction spent its sequence number; the new quote uses
    // the next one.
    expect(sequenceOf(network.quotes[0])).toBe(STARTING_SEQUENCE + 1n)
    expect(sequenceOf(network.quotes[1])).toBe(STARTING_SEQUENCE + 2n)
    // The wallet was asked again, for the new envelope.
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[0], signOptions],
      [network.quotes[1], signOptions],
    ])
    expect(envelopesToSign(page)).toEqual(network.quotes)
    // The node received exactly the envelopes the wallet signed, in order:
    // full XDR, signatures included.
    const signed = await signedEnvelopes(page)
    expect(network.sent).toEqual(signed)
    expect(signed.map(hashOf)).toEqual([first, second])
    // "Try again" signs a new transaction, not the failed one again.
    expect(signed[1]).not.toEqual(signed[0])
    // Every field of both signed envelopes. They differ in the sequence
    // number and in the quote number (an argument the fake API adds; the
    // harness module is fresh for each spec file, so this file's quotes
    // are 1 and 2).
    expect(signed.map(envelopeFieldsOf)).toEqual([
      quotedSwapFields(
        page.walletAddress,
        STARTING_SEQUENCE + 1n,
        1,
        firstFrom,
        firstTo
      ),
      quotedSwapFields(
        page.walletAddress,
        STARTING_SEQUENCE + 2n,
        2,
        retryFrom,
        retryTo
      ),
    ])
    expect(network.rpcMethods).toEqual([
      // The failed run: CheckBalanceTask (SAC balance), then the submission.
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
      // "Try again": CheckBalanceTask again, then the new submission.
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.XLM),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.XLM),
        txHash: second,
        bridge: 'soroswap',
      },
    ])
    expect(retry.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
    const execution = stepOf(resumed).execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.error).toBeUndefined()
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        chainId: ChainId.XLM,
        txHash: second,
        txLink: `${STATUS_EXPLORER_URL}tx/${second}`,
      }),
    ])
    expect(actionOf(resumed, 'SWAP')?.error).toBeUndefined()
    expect(execution?.toAmount).toBe(SWAP_RECEIVED_AMOUNT)
  })
})
