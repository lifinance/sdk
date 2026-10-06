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
  MOVE_ABORT,
  openPage,
  recordRouteUpdates,
  STATUS_EXPLORER_URL,
  SUI_EXPLORER_URL,
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

describe('Sui on-chain failure', () => {
  it('fails the step on a Move abort; Try again signs and executes a new transaction', async () => {
    const page = openPage(network)
    network.failNextExecution = MOVE_ABORT
    const first = recordRouteUpdates()

    const error = (await executeRoute(
      page.client,
      buildRoute('swap', page.walletAddress),
      { updateRouteHook: first.hook }
    ).catch((e: unknown) => e)) as SDKError

    expect(error.code).toBe(LiFiErrorCode.TransactionFailed)
    const failedDigest = digestOf(network.quotes[0])
    // The transaction was signed and executed once, and failed on chain.
    expect(signedBytes(page)).toEqual(network.quotes)
    expect(network.executed).toEqual([
      { bytes: network.quotes[0], signatures: await signatures(page) },
    ])
    expect(network.landed.get(failedDigest)).toEqual(MOVE_ABORT)
    // The failure is the execution result: no wait, no `/status`.
    // #507: the SDK signs, then calls executeTransaction itself; no signAndExecuteTransaction (spec §4.6)
    expect(network.methods).toEqual([
      'grpc.listBalances',
      'grpc.ledgerService.getServiceInfo',
      'client.executeTransaction',
    ])
    expect(network.statusRequests).toEqual([])
    // main: SuiSignAndExecuteTask sets the action to PENDING before it
    // checks the execution result, so a failed execution shows PENDING,
    // then FAILED; #507: the same sequence, but the PENDING write is the
    // write of the signed bytes before the send (spec §4.6 step 2).
    expect(first.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:FAILED',
    ])
    const stored = first.snapshots.at(-1)
    expect(stored).toBeDefined()
    expect(stepOf(stored!).execution).toMatchObject({
      status: 'FAILED',
      error: {
        code: LiFiErrorCode.TransactionFailed,
        // main: SuiSignAndExecuteTask puts the ExecutionError object into a
        // template string, so the message is "Transaction failed: [object
        // Object]"; #507: see the next line (addendum §2).
        // #507: the message uses status.error.message, not the object (addendum §2)
        message: `Transaction failed: ${MOVE_ABORT.message}`,
      },
      actions: [
        {
          type: 'SWAP',
          status: 'FAILED',
          error: { code: LiFiErrorCode.TransactionFailed },
        },
      ],
    })
    // main: the failed action keeps no digest, so the user gets no link to
    // the failed transaction; #507: the sign task writes the digest and the
    // link of a FailedTransaction too (spec §4.6 step 4).
    const failedAction = stepOf(stored!).execution?.actions[0]
    expect(failedAction).toBeDefined()
    // #507: a FailedTransaction has a digest; the sign task writes it as txHash (spec §4.6)
    expect(failedAction!.txHash).toBe(failedDigest)
    // #507: the sign task writes the txLink with the digest of a FailedTransaction (spec §4.6)
    expect(failedAction!.txLink).toBe(
      `${SUI_EXPLORER_URL}txblock/${failedDigest}`
    )

    // "Try again": the widget resumes the route it stored.
    const retry = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, stored!, {
      updateRouteHook: retry.hook,
    })

    // A new quote, a new transaction: new bytes, a new signature, a new
    // digest. The wallet signs once per quote.
    expect(network.stepTransactionRequests).toHaveLength(2)
    expect(network.quotes[1]).not.toBe(network.quotes[0])
    expect(signedBytes(page)).toEqual(network.quotes)
    const [firstSignature, secondSignature] = await signatures(page)
    expect(secondSignature).toBeDefined()
    expect(secondSignature).not.toBe(firstSignature)
    expect(network.executed).toEqual([
      { bytes: network.quotes[0], signatures: [firstSignature] },
      { bytes: network.quotes[1], signatures: [secondSignature] },
    ])
    const digest = digestOf(network.quotes[1])
    expect(digest).not.toBe(failedDigest)
    // The node executed two different digests: the first failed, the
    // second succeeded.
    expect([...network.landed]).toEqual([
      [failedDigest, MOVE_ABORT],
      [digest, null],
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
    expect(execution?.actions).toEqual([
      expect.objectContaining({
        type: 'SWAP',
        status: 'DONE',
        txHash: digest,
        txLink: `${STATUS_EXPLORER_URL}tx/${digest}`,
      }),
    ])
  })
})
