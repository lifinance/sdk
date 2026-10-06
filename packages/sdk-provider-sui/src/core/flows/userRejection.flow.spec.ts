import {
  executeRoute,
  LiFiErrorCode,
  resumeRoute,
  type SDKError,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoute,
  digestOf,
  type FakeSuiNetwork,
  installFakeSuiNetwork,
  NODE_REJECTION_MESSAGE,
  openPage,
  recordRouteUpdates,
  rejectNextSignature,
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
    // Spec §3.1: a call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Sui user rejection', () => {
  it('fails the step with SignatureRejected, sends nothing, and Try again asks the wallet again', async () => {
    const page = openPage(network)
    rejectNextSignature(page)
    const first = recordRouteUpdates()

    const error = (await executeRoute(
      page.client,
      buildRoute('swap', page.walletAddress),
      { updateRouteHook: first.hook }
    ).catch((e: unknown) => e)) as SDKError

    expect(error.code).toBe(LiFiErrorCode.SignatureRejected)
    // The wallet was asked once, for the quoted bytes; nothing reached a node.
    expect(signedBytes(page)).toEqual(network.quotes)
    expect(network.executed).toEqual([])
    // #507: the SDK calls the signer itself, so a rejection calls no client method (spec §4.6)
    expect(network.methods).toEqual([
      'grpc.listBalances',
      'grpc.ledgerService.getServiceInfo',
    ])
    expect(network.statusRequests).toEqual([])
    expect(first.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:FAILED',
    ])
    const stored = first.snapshots.at(-1)
    expect(stored).toBeDefined()
    expect(stepOf(stored!).execution).toMatchObject({
      status: 'FAILED',
      error: { code: LiFiErrorCode.SignatureRejected },
    })

    // "Try again": the widget resumes the route it stored.
    const retry = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, stored!, {
      updateRouteHook: retry.hook,
    })

    // The retry asks for a new quote and asks the wallet again.
    expect(network.stepTransactionRequests).toHaveLength(2)
    expect(signedBytes(page)).toEqual(network.quotes)
    expect(network.executed).toEqual([
      { bytes: network.quotes[1], signatures: await signatures(page) },
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

  it('reports a node error whose text contains "rejected" as InternalError, not SignatureRejected', async () => {
    const page = openPage(network)
    network.refuseNextExecution = new Error(NODE_REJECTION_MESSAGE)
    const updates = recordRouteUpdates()

    const error = (await executeRoute(
      page.client,
      buildRoute('swap', page.walletAddress),
      { updateRouteHook: updates.hook }
    ).catch((e: unknown) => e)) as SDKError

    // The wallet signed and the request reached the node...
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    expect(signedBytes(page)).toEqual(network.quotes)
    expect(network.executed).toEqual([
      { bytes: network.quotes[0], signatures: await signatures(page) },
    ])
    // main: `parseSuiErrors` maps any error text containing "reject" to
    // SignatureRejected, so a node refusal reads as "the user rejected"; #507:
    // only an error of the wallet's own `signTransaction` call can be
    // SignatureRejected, and `parseSuiErrors` no longer maps "reject"
    // (addendum §3.1).
    // #507: a node "reject" text is not a user rejection; parseSuiErrors gives UnknownError (addendum §3.1)
    expect(error.code).toBe(LiFiErrorCode.InternalError)
    // ...which refused it: no wait for the digest and no `/status` poll.
    // #507: the SDK signs, then calls executeTransaction itself; no signAndExecuteTransaction (spec §4.6)
    expect(network.methods).toEqual([
      'grpc.listBalances',
      'grpc.ledgerService.getServiceInfo',
      'client.executeTransaction',
    ])
    expect(network.statusRequests).toEqual([])
    // #507 accepted (task RS1): every non-EVM provider (Solana, Tron, Sui, Bitcoin, Stellar) writes the signed bytes with status PENDING before it sends; spec §4.6 step 2 requires the write; no code change
    expect(updates.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    const stored = updates.snapshots.at(-1)
    expect(stored).toBeDefined()
    expect(stepOf(stored!).execution).toMatchObject({
      status: 'FAILED',
      // #507: a node "reject" text is not a user rejection; parseSuiErrors gives UnknownError (addendum §3.1)
      error: { code: LiFiErrorCode.InternalError },
      actions: [
        {
          type: 'SWAP',
          status: 'FAILED',
          // #507: a node "reject" text is not a user rejection; parseSuiErrors gives UnknownError (addendum §3.1)
          error: { code: LiFiErrorCode.InternalError },
        },
      ],
    })
  })
})
