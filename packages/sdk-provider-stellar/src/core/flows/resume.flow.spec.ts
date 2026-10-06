import {
  ChainId,
  executeRoute,
  LiFiErrorCode,
  type RouteExtended,
  resumeRoute,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actionOf,
  buildRoute,
  envelopesToSign,
  type FakeStellarNetwork,
  hashOf,
  installFakeStellarNetwork,
  NETWORK_PASSPHRASE,
  openPage,
  type Page,
  recordRouteUpdates,
  STARTING_SEQUENCE,
  STATUS_EXPLORER_URL,
  SWAP_RECEIVED_AMOUNT,
  sequenceOf,
  signedEnvelopes,
  stepOf,
} from './harness.mock.js'

// Spec 2026-10-05-money-path-matrix-design.md §5 step 4 (Stellar resume
// variants), on the #507 branch (resume-without-resign spec §4.2 and the
// §4.3 Stellar row). A reload is: take the route as storage held it (the
// JSON snapshot `updateRouteHook` wrote), open a new page with the same
// wallet key (new client, provider and wallet), then `resumeRoute`.

let network: FakeStellarNetwork

beforeEach(() => {
  network = installFakeStellarNetwork()
})

afterEach(() => {
  try {
    // Spec §3.1: a call or request the fakes do not know fails the spec.
    expect(network.unexpected).toEqual([])
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

/** What the network saw from `from` on: the resume's own calls. */
const since = (from: Marks) => ({
  rpcMethods: network.rpcMethods.slice(from.rpcMethods),
  sent: network.sent.slice(from.sent),
  quotes: network.quotes.slice(from.quotes),
  statusRequests: network.statusRequests.slice(from.statusRequests),
})
type Marks = ReturnType<typeof mark>
const mark = () => ({
  rpcMethods: network.rpcMethods.length,
  sent: network.sent.length,
  quotes: network.quotes.length,
  statusRequests: network.statusRequests.length,
})

/** The options the SDK passes with every `signTransaction` call. */
const signOptionsOf = (page: Page) => ({
  address: page.walletAddress,
  networkPassphrase: NETWORK_PASSPHRASE,
})

/** The `/status` query of the same-chain swap of `page` for `txHash`. */
const statusQueryOf = (page: Page, txHash: string) => ({
  fromChain: String(ChainId.XLM),
  fromAddress: page.walletAddress,
  toChain: String(ChainId.XLM),
  txHash,
  bridge: 'soroswap',
})

/** The final route of a swap that completed with `txHash`. */
const expectSwapDone = (route: RouteExtended, txHash: string): void => {
  // main: the final same-chain txHash/txLink come from the LI.FI /status answer (core WaitForTransactionStatusTask)
  const execution = stepOf(route).execution
  expect(execution?.status).toBe('DONE')
  expect(execution?.error).toBeUndefined()
  expect(execution?.actions).toEqual([
    expect.objectContaining({
      type: 'SWAP',
      status: 'DONE',
      chainId: ChainId.XLM,
      txHash,
      txLink: `${STATUS_EXPLORER_URL}tx/${txHash}`,
    }),
  ])
  expect(actionOf(route, 'SWAP')?.error).toBeUndefined()
  expect(execution?.toAmount).toBe(SWAP_RECEIVED_AMOUNT)
}

/**
 * Runs a swap to the end. Returns what storage held at the first hook call
 * after the envelope reached the node, and the envelope the wallet signed.
 */
const runSwapAndKeepSnapshotAfterSubmit = async (
  page: Page
): Promise<{ afterSubmit: RouteExtended; signed: string }> => {
  const updates = recordRouteUpdates()
  let sentAt: number | undefined
  network.onSend = () => {
    sentAt ??= updates.snapshots.length
  }
  await executeRoute(page.client, buildRoute('swap', page.walletAddress), {
    updateRouteHook: updates.hook,
  })
  network.onSend = undefined
  // The first run: one signature, for the quoted envelope; the node
  // received exactly the envelope the wallet signed (full XDR), once.
  expect(page.signTransaction.mock.calls).toEqual([
    [network.quotes[0], signOptionsOf(page)],
  ])
  const signed = await signedEnvelopes(page)
  expect(network.sent).toEqual(signed)
  const afterSubmit = updates.snapshots[sentAt!]
  expect(actionOf(afterSubmit, 'SWAP')).toMatchObject({
    status: 'PENDING',
    txHash: hashOf(signed[0]),
    txHex: signed[0],
  })
  return { afterSubmit, signed: signed[0] }
}

/**
 * Runs a swap whose envelope the node accepts but RPC does not report in
 * time, until the confirmation poll times out. Returns what storage held
 * at the end and the envelope the wallet signed.
 */
const runSwapToConfirmationTimeout = async (
  page: Page
): Promise<{ failed: RouteExtended; signed: string }> => {
  // waitForStellarTransaction polls every 3 s for 330 s (Date.now based).
  vi.useFakeTimers()
  const updates = recordRouteUpdates()
  network.hideNextLanding = true
  const run = executeRoute(
    page.client,
    buildRoute('swap', page.walletAddress),
    { updateRouteHook: updates.hook }
  ).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(333_000)
  expect(await run).toMatchObject({ code: LiFiErrorCode.Timeout })
  vi.useRealTimers()
  // One signature, for the quoted envelope; the node received exactly the
  // envelope the wallet signed (full XDR), once.
  expect(page.signTransaction.mock.calls).toEqual([
    [network.quotes[0], signOptionsOf(page)],
  ])
  const [signed] = await signedEnvelopes(page)
  expect(network.sent).toEqual([signed])
  const hash = hashOf(network.quotes[0])
  expect(hashOf(signed)).toBe(hash)
  const failed = updates.snapshots.at(-1) as RouteExtended
  expect(stepOf(failed).execution?.status).toBe('FAILED')
  // #507 behaviour: a timeout is an unknown outcome, not a final one. The
  // action keeps the hash and the stored envelope.
  expect(actionOf(failed, 'SWAP')).toMatchObject({
    status: 'FAILED',
    txHash: hash,
    txHex: signed,
    error: { code: LiFiErrorCode.Timeout },
  })
  expect(actionOf(failed, 'SWAP')?.txFinal).toBeUndefined()
  return { failed, signed }
}

describe('Stellar reload', () => {
  it('after the submit: waits for the landed transaction, no signature, no quote, no send', async () => {
    const page = openPage(network)
    const { afterSubmit, signed } =
      await runSwapAndKeepSnapshotAfterSubmit(page)
    const hash = hashOf(signed)

    const before = mark()
    const reloaded = openPage(network, page.keypair)
    const resume = recordRouteUpdates()
    const resumed = await resumeRoute(reloaded.client, afterSubmit, {
      updateRouteHook: resume.hook,
    })

    // #507 behaviour: the resume enters at StellarWaitForTransactionTask
    // and never asks the wallet.
    expect(reloaded.signTransaction).not.toHaveBeenCalled()
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    const seen = since(before)
    expect(seen.quotes).toEqual([])
    // #507 behaviour: the probe finds the transaction, so the stored
    // envelope is not sent again; the poll confirms it.
    expect(seen.sent).toEqual([])
    expect(seen.rpcMethods).toEqual(['getTransaction', 'getTransaction'])
    expect(seen.statusRequests).toEqual([statusQueryOf(page, hash)])
    expect(resume.changes).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    expectSwapDone(resumed, hash)
  })

  it('between signing and the submit: resubmits exactly the stored envelope, no signature, no quote', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    // The page dies when the envelope leaves the SDK: storage holds what
    // the last hook call wrote before the send.
    let afterSigning: RouteExtended | undefined
    network.onSend = () => {
      afterSigning ??= updates.snapshots.at(-1)
    }
    await executeRoute(page.client, buildRoute('swap', page.walletAddress), {
      updateRouteHook: updates.hook,
    })
    network.onSend = undefined
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[0], signOptionsOf(page)],
    ])
    const [signed] = await signedEnvelopes(page)
    const hash = hashOf(signed)
    expect(network.sent).toEqual([signed])
    // #507 behaviour: StellarSignAndExecuteTask writes txHash and txHex
    // before the submit.
    expect(actionOf(afterSigning!, 'SWAP')).toMatchObject({
      status: 'PENDING',
      txHash: hash,
      txHex: signed,
    })
    // The envelope never reached a node.
    network.forgetChain()

    const before = mark()
    const reloaded = openPage(network, page.keypair)
    const resume = recordRouteUpdates()
    const resumed = await resumeRoute(reloaded.client, afterSigning!, {
      updateRouteHook: resume.hook,
    })

    // #507 behaviour: no new signature; the stored envelope goes out.
    expect(reloaded.signTransaction).not.toHaveBeenCalled()
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    const seen = since(before)
    expect(seen.quotes).toEqual([])
    // Probe (NOT_FOUND), the stored envelope byte for byte, then the poll.
    expect(seen.rpcMethods).toEqual([
      'getTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    expect(seen.sent).toEqual([signed])
    expect(seen.statusRequests).toEqual([statusQueryOf(page, hash)])
    expect(resume.changes).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    expectSwapDone(resumed, hash)
  })

  it('resumes an open transaction in the background and completes without the wallet', async () => {
    const page = openPage(network)
    const { afterSubmit, signed } =
      await runSwapAndKeepSnapshotAfterSubmit(page)
    const hash = hashOf(signed)

    const before = mark()
    const reloaded = openPage(network, page.keypair)
    const resume = recordRouteUpdates()
    const resumed = await resumeRoute(reloaded.client, afterSubmit, {
      updateRouteHook: resume.hook,
      executeInBackground: true,
    })

    expect(reloaded.signTransaction).not.toHaveBeenCalled()
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    const seen = since(before)
    expect(seen.quotes).toEqual([])
    expect(seen.sent).toEqual([])
    // #507 behaviour: no interaction gate: the step never asks for the
    // user.
    expect(resume.changes).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    expect(seen.rpcMethods).toEqual(['getTransaction', 'getTransaction'])
    expect(seen.statusRequests).toEqual([statusQueryOf(page, hash)])
    expectSwapDone(resumed, hash)
  })
})

describe('Stellar "Try again" after a failure', () => {
  it('signs a new transaction after a final failure (FAILED on chain)', async () => {
    const page = openPage(network)
    const updates = recordRouteUpdates()
    network.failNextLanding = true
    await expect(
      executeRoute(page.client, buildRoute('swap', page.walletAddress), {
        updateRouteHook: updates.hook,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionFailed })
    const failed = updates.snapshots.at(-1) as RouteExtended
    const first = hashOf(network.quotes[0])
    expect(network.sent).toEqual(await signedEnvelopes(page))
    expect(network.sent.map(hashOf)).toEqual([first])
    expect(stepOf(failed).execution?.status).toBe('FAILED')
    // #507 behaviour: the ledger's FAILED verdict is a final outcome.
    expect(actionOf(failed, 'SWAP')).toMatchObject({
      status: 'FAILED',
      txHash: first,
      txFinal: true,
      error: { code: LiFiErrorCode.TransactionFailed },
    })

    const stored = structuredClone(failed)
    const before = mark()
    const retry = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, failed, {
      updateRouteHook: retry.hook,
    })
    // #507 behaviour: resumeRoute restarts a clone; the caller's route
    // (the widget's store) is unchanged.
    expect(failed).toEqual(stored)

    const seen = since(before)
    expect(seen.quotes).toHaveLength(1)
    // The failed transaction spent its sequence number; the new quote uses
    // the next one.
    expect(sequenceOf(seen.quotes[0])).toBe(STARTING_SEQUENCE + 2n)
    // The wallet signs the new quote, and the node receives exactly the
    // envelope it signed (full XDR).
    expect(page.signTransaction.mock.calls).toEqual([
      [network.quotes[0], signOptionsOf(page)],
      [network.quotes[1], signOptionsOf(page)],
    ])
    expect(envelopesToSign(page)).toEqual(network.quotes)
    const signed = await signedEnvelopes(page)
    expect(seen.sent).toEqual([signed[1]])
    const second = hashOf(seen.quotes[0])
    expect(second).not.toBe(first)
    expect(seen.rpcMethods).toEqual([
      // CheckBalanceTask: SAC balance.
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
    ])
    expect(seen.statusRequests).toEqual([statusQueryOf(page, second)])
    expect(retry.changes).toEqual([
      'SWAP:STARTED',
      'SWAP:ACTION_REQUIRED',
      'SWAP:PENDING',
      'SWAP:DONE',
    ])
    expectSwapDone(resumed, second)
    expect(actionOf(resumed, 'SWAP')?.txFinal).toBeUndefined()
  })

  it('does not sign after an unknown failure (the confirmation poll timed out)', async () => {
    const page = openPage(network)
    const { failed, signed } = await runSwapToConfirmationTimeout(page)
    const hash = hashOf(signed)

    // RPC catches up: the transaction had landed.
    network.releaseHidden()
    const stored = structuredClone(failed)
    const before = mark()
    const retry = recordRouteUpdates()
    const resumed = await resumeRoute(page.client, failed, {
      updateRouteHook: retry.hook,
    })
    // #507 behaviour: resumeRoute restarts a clone; the caller's route
    // (the widget's store) is unchanged.
    expect(failed).toEqual(stored)

    // #507 behaviour (main signs a second transaction here): "Try again"
    // checks the stored transaction again and never asks the wallet. The
    // probe finds it, so nothing is sent.
    expect(page.signTransaction).toHaveBeenCalledTimes(1)
    const seen = since(before)
    expect(seen.quotes).toEqual([])
    expect(seen.sent).toEqual([])
    expect(seen.rpcMethods).toEqual(['getTransaction', 'getTransaction'])
    expect(seen.statusRequests).toEqual([statusQueryOf(page, hash)])
    expect(retry.changes).toEqual(['SWAP:PENDING', 'SWAP:DONE'])
    expectSwapDone(resumed, hash)
  })
})
