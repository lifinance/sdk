import {
  ChainId,
  type ExecutionAction,
  LiFiErrorCode,
  MAX_RESEND_AGE_MS,
  type RouteExtended,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  BRIDGE_RECEIVED_AMOUNT,
  BTC_EXPLORER_URL,
  BTC_RPC_URL,
  buildRoute,
  clearBigmiObservers,
  destinationTxHashOf,
  type FakeBitcoinNetwork,
  FROM_AMOUNT,
  finalizedHexOf,
  installFakeBitcoinNetwork,
  liveBigmiObservers,
  openPage,
  type Page,
  QUOTE_FEE,
  recordRouteUpdates,
  SPEED_UP_EXTRA_FEE,
  settleWithFakeTime,
  signedPsbts,
  stepOf,
  txidOf,
  WALLET_BALANCE,
} from './harness.mock.js'

// The resume variants of the #507 specs for Bitcoin. A reload is a new page
// (fresh `@lifi/sdk` and provider modules, the same wallet key) that resumes
// the route storage held (a JSON copy from `updateRouteHook`).
// Every test uses fake time: the resend and the replacement scan sleep
// before the wait task reads the chain.

let network: FakeBitcoinNetwork

beforeEach(() => {
  network = installFakeBitcoinNetwork()
  vi.useFakeTimers()
})

afterEach(() => {
  const live = liveBigmiObservers()
  clearBigmiObservers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  expect({ live, unexpected: network.unexpected }).toEqual({
    live: [],
    unexpected: [],
  })
})

const crossChainOf = (route: RouteExtended): ExecutionAction | undefined =>
  stepOf(route).execution?.actions.find(
    (action) => action.type === 'CROSS_CHAIN'
  )

/** The `signPsbt` call for `quote`: the quoted PSBT, unchanged. */
const signCallOf = (page: Page, quote: string) => [
  {
    psbt: quote,
    inputsToSign: [
      { address: page.walletAddress, sigHash: 1, signingIndexes: [0] },
    ],
    finalize: false,
  },
]

/**
 * The node's answer to every `sendrawtransaction` that reaches it from now
 * on: the `result`, or the JSON-RPC `error`.
 */
const recordSendAnswers = (): unknown[] => {
  const answers: unknown[] = []
  const nodeFetch = network.fetch
  network.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nodeFetch(input, init)
    if (
      input === BTC_RPC_URL &&
      (JSON.parse(String(init?.body)) as { method: string }).method ===
        'sendrawtransaction'
    ) {
      const { result, error } = (await response.clone().json()) as {
        result?: unknown
        error?: unknown
      }
      answers.push(error ?? result)
    }
    return response
  }) as typeof fetch
  return answers
}

/**
 * The final route of a completed bridge: the execution status and
 * `toAmount`, and both actions with their hashes and links.
 */
const expectBridgeDone = (route: RouteExtended, txid: string): void => {
  const execution = stepOf(route).execution
  expect(execution?.status).toBe('DONE')
  expect(execution?.toAmount).toBe(BRIDGE_RECEIVED_AMOUNT)
  expect(
    execution?.actions.map(({ type, status, chainId, txHash, txLink }) => ({
      type,
      status,
      chainId,
      txHash,
      txLink,
    }))
  ).toEqual([
    {
      type: 'CROSS_CHAIN',
      status: 'DONE',
      chainId: ChainId.BTC,
      txHash: txid,
      txLink: `${BTC_EXPLORER_URL}tx/${txid}`,
    },
    {
      type: 'RECEIVING_CHAIN',
      status: 'DONE',
      chainId: ChainId.ARB,
      txHash: destinationTxHashOf(txid),
      txLink: `${ARB_EXPLORER_URL}tx/${destinationTxHashOf(txid)}`,
    },
  ])
}

/**
 * Runs a bridge to the end on `page` and returns what storage held while
 * the CROSS_CHAIN transaction was pending: the one PENDING write, made
 * before the send. The send succeeded, so this is also what storage holds
 * after the send.
 */
const storedAfterSend = async (page: Page): Promise<RouteExtended> => {
  const updates = recordRouteUpdates()
  await settleWithFakeTime(
    page.executeRoute(buildRoute(page.walletAddress), {
      updateRouteHook: updates.hook,
    })
  )
  const pending = updates.snapshots.filter(
    (snapshot) => crossChainOf(snapshot)?.status === 'PENDING'
  )
  expect(pending).toHaveLength(1)
  // The first page: one signature of the quoted PSBT, and one send of
  // exactly the bytes it finalizes to. Storage holds those bytes.
  expect(page.signPsbt.mock.calls).toEqual([
    signCallOf(page, network.quotes[0]),
  ])
  const [signed] = await signedPsbts(page)
  const txHex = finalizedHexOf(signed)
  expect(network.sent).toEqual([txHex])
  expect(crossChainOf(pending[0])).toMatchObject({
    txHex,
    txHash: txidOf(txHex),
  })
  return pending[0]
}

const AFTER_THE_WAIT = [
  'CROSS_CHAIN:DONE',
  'RECEIVING_CHAIN:PENDING',
  'RECEIVING_CHAIN:DONE',
]

describe('Bitcoin reload', () => {
  it('waits for the sent transaction after a reload and never signs again', async () => {
    const first = await openPage(network)
    const stored = await storedAfterSend(first)
    const { txHash, txHex } = crossChainOf(stored) as ExecutionAction
    expect(network.isMined(txHash as string)).toBe(true)

    const reloaded = await openPage(network, first.key)
    const updates = recordRouteUpdates()
    const answers = recordSendAnswers()
    const before = network.rpcMethods.length
    const resumed = await settleWithFakeTime(
      reloaded.resumeRoute(stored, { updateRouteHook: updates.hook })
    )

    expect(first.signPsbt).toHaveBeenCalledTimes(1)
    expect(reloaded.signPsbt).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toHaveLength(1)
    // #507 behaviour: within MAX_RESEND_AGE_MS the wait task resends the
    // stored bytes once, in one round. The node holds them in a block and
    // answers -27; the wait ignores the answer.
    expect(network.sent).toEqual([txHex, txHex])
    expect(answers).toEqual([
      { code: -27, message: 'Transaction outputs already in utxo set' },
    ])
    expect(network.rpcMethods.slice(before)).toEqual([
      'sendrawtransaction',
      'getblockcount',
      'getrawtransaction',
      'getblockstats',
    ])
    expect(updates.changes).toEqual(AFTER_THE_WAIT)
    expect(network.statusRequests.map((query) => query.txHash)).toEqual([
      txHash,
      txHash,
    ])
    expectBridgeDone(resumed, txHash as string)
  })

  it('resends the stored txHex after a reload between signing and the send, and never signs again', async () => {
    const first = await openPage(network)
    const updates = recordRouteUpdates()
    let stored: RouteExtended | undefined
    let leaving: string | undefined
    // The page dies as the first send leaves the SDK: storage holds the last
    // route update, and the bytes never reach a node.
    network.onSend = (hex) => {
      if (!stored) {
        stored = updates.snapshots.at(-1)
        leaving = hex
      }
    }
    network.failNextSend = 'unreachable'
    const firstPageError = await settleWithFakeTime(
      first.executeRoute(buildRoute(first.walletAddress), {
        updateRouteHook: updates.hook,
      })
    ).then(
      () => undefined,
      (reason: unknown) => reason as { code?: unknown }
    )
    network.onSend = undefined

    // The bytes that left the SDK are exactly the signed quote.
    expect(first.signPsbt.mock.calls).toEqual([
      signCallOf(first, network.quotes[0]),
    ])
    const [signed] = await signedPsbts(first)
    const sentHex = leaving as string
    expect(sentHex).toBe(finalizedHexOf(signed))
    // #507 behaviour: the sign task writes txHex, txHash and signedAt
    // before the send, so storage already holds the signed bytes.
    expect(stored).toBeDefined()
    const storedRoute = stored as RouteExtended
    expect(crossChainOf(storedRoute)).toMatchObject({
      status: 'PENDING',
      txHex: sentHex,
      txHash: txidOf(sentHex),
    })
    expect(stepOf(storedRoute).execution?.signedAt).toEqual(expect.any(Number))
    // #507 behaviour: the first page's own end. An unknown send failure
    // keeps the bytes and is not final.
    expect(firstPageError?.code).toBe(LiFiErrorCode.InternalError)
    const failed = updates.snapshots.at(-1) as RouteExtended
    expect(stepOf(failed).execution?.status).toBe('FAILED')
    expect(crossChainOf(failed)).toMatchObject({
      status: 'FAILED',
      txHex: sentHex,
      txHash: txidOf(sentHex),
      error: { code: LiFiErrorCode.InternalError },
    })
    expect(crossChainOf(failed)?.txFinal).toBeUndefined()
    expect(network.lostSends).toEqual([sentHex])
    expect(network.sent).toEqual([])
    expect(network.isMined(txidOf(sentHex))).toBe(false)

    const reloaded = await openPage(network, first.key)
    const reloadUpdates = recordRouteUpdates()
    const answers = recordSendAnswers()
    const before = network.rpcMethods.length
    const resumed = await settleWithFakeTime(
      reloaded.resumeRoute(storedRoute, { updateRouteHook: reloadUpdates.hook })
    )

    expect(first.signPsbt).toHaveBeenCalledTimes(1)
    expect(reloaded.signPsbt).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toHaveLength(1)
    // #507 behaviour: one resend of exactly the stored bytes, in one round;
    // the node takes them.
    expect(network.sent).toEqual([sentHex])
    expect(answers).toEqual([txidOf(sentHex)])
    expect(network.rpcMethods.slice(before)).toEqual([
      'sendrawtransaction',
      'getblockcount',
      'getrawtransaction',
      'getblockstats',
    ])
    expect(network.isMined(txidOf(sentHex))).toBe(true)
    expect(reloadUpdates.changes).toEqual(AFTER_THE_WAIT)
    expectBridgeDone(resumed, txidOf(sentHex))
  })

  it('completes a background resume of an open transaction without the wallet', async () => {
    const first = await openPage(network)
    const stored = await storedAfterSend(first)
    const { txHash, txHex } = crossChainOf(stored) as ExecutionAction

    const reloaded = await openPage(network, first.key)
    const updates = recordRouteUpdates()
    const resumed = await settleWithFakeTime(
      reloaded.resumeRoute(stored, {
        updateRouteHook: updates.hook,
        executeInBackground: true,
      })
    )

    // The resume-by-hash path needs no user interaction, so the background
    // run neither pauses nor asks the wallet.
    expect(reloaded.signPsbt).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toHaveLength(1)
    // #507 behaviour: the first page sent the bytes once; the background
    // resume resends exactly the stored bytes once.
    expect(network.sent).toEqual([txHex, txHex])
    expect(updates.changes).toEqual(AFTER_THE_WAIT)
    expectBridgeDone(resumed, txHash as string)
  })

  it('resends the stale txHex after a reload that follows a repriced replacement, and waits for the replacement', async () => {
    const first = await openPage(network)
    const updates = recordRouteUpdates()
    // The user speeds the transaction up in the wallet app right after the
    // send.
    network.replaceNextSend = 'repriced'
    await settleWithFakeTime(
      first.executeRoute(buildRoute(first.walletAddress), {
        updateRouteHook: updates.hook,
      })
    )
    expect(first.signPsbt.mock.calls).toEqual([
      signCallOf(first, network.quotes[0]),
    ])
    const [signed] = await signedPsbts(first)
    const originalHex = finalizedHexOf(signed)
    expect(network.sent).toEqual([originalHex])
    const original = txidOf(originalHex)
    const [replacement] = network.replacements
    // The page dies after the wait saw the replacement and before the
    // CROSS_CHAIN action was DONE: storage holds the last PENDING write.
    // For a bridge this window is narrow: the replacement write and the DONE
    // write run in one synchronous continuation. The same stored state lasts
    // longer for a same-chain SWAP, which stays PENDING for the whole
    // `/status` wait (also on "Try again" after a `/status` error), and with
    // an integrator hook that persists asynchronously.
    const stored = updates.snapshots
      .filter((snapshot) => crossChainOf(snapshot)?.status === 'PENDING')
      .at(-1) as RouteExtended
    // #507 behaviour, as on main: after a repriced
    // replacement, txHash names the replacement while txHex keeps the
    // original bytes.
    expect(crossChainOf(stored)).toMatchObject({
      status: 'PENDING',
      txHash: replacement,
      txLink: `${BTC_EXPLORER_URL}tx/${replacement}`,
      txHex: originalHex,
    })
    // The reload comes within MAX_RESEND_AGE_MS of the signature.
    expect(
      Date.now() - (stepOf(stored).execution?.signedAt as number)
    ).toBeLessThan(MAX_RESEND_AGE_MS)

    const reloaded = await openPage(network, first.key)
    const reloadUpdates = recordRouteUpdates()
    const answers = recordSendAnswers()
    const before = network.rpcMethods.length
    const resumed = await settleWithFakeTime(
      reloaded.resumeRoute(stored, { updateRouteHook: reloadUpdates.hook })
    )

    expect(reloaded.signPsbt).not.toHaveBeenCalled()
    expect(network.stepTransactionRequests).toHaveLength(1)
    // #507 behaviour: the wait task resends the stored txHex, which are the
    // original bytes, not the replacement. The node refuses them: the mined
    // replacement already spent their input. The wait ignores the answer
    // and follows txHash, the replacement.
    expect(network.sent).toEqual([originalHex, originalHex])
    expect(answers).toEqual([
      { code: -25, message: 'bad-txns-inputs-missingorspent' },
    ])
    expect(network.rpcMethods.slice(before)).toEqual([
      'sendrawtransaction',
      'getblockcount',
      'getrawtransaction',
      'getblockstats',
    ])
    expect(network.isMined(original)).toBe(false)
    expect(network.isMined(replacement)).toBe(true)
    expect(network.statusRequests.map((query) => query.txHash)).toEqual([
      replacement,
      replacement,
    ])
    expect(reloadUpdates.changes).toEqual(AFTER_THE_WAIT)
    expectBridgeDone(resumed, replacement)
    // The money moved once: the replacement only.
    expect(network.balanceOf(first.walletAddress)).toBe(
      WALLET_BALANCE - BigInt(FROM_AMOUNT) - QUOTE_FEE - SPEED_UP_EXTRA_FEE
    )
  })
})

describe('Bitcoin "Try again"', () => {
  it('signs a new transaction after a cancelled replacement (final)', async () => {
    const page = await openPage(network)
    const updates = recordRouteUpdates()
    network.replaceNextSend = 'cancelled'
    const error = await settleWithFakeTime(
      page.executeRoute(buildRoute(page.walletAddress), {
        updateRouteHook: updates.hook,
      })
    ).then(
      () => undefined,
      (reason: unknown) => reason as { code?: unknown }
    )

    expect(page.signPsbt.mock.calls).toEqual([
      signCallOf(page, network.quotes[0]),
    ])
    const [firstSigned] = await signedPsbts(page)
    const originalHex = finalizedHexOf(firstSigned)
    expect(network.sent).toEqual([originalHex])
    const [cancel] = network.replacements
    // A cancelled replacement is final.
    expect(error?.code).toBe(LiFiErrorCode.TransactionCanceled)
    const failed = updates.snapshots.at(-1) as RouteExtended
    expect(stepOf(failed).execution?.status).toBe('FAILED')
    // #507 behaviour: the FAILED action names the cancel
    // and keeps the original bytes in txHex, and it carries txFinal.
    expect(crossChainOf(failed)).toMatchObject({
      status: 'FAILED',
      txFinal: true,
      txHash: cancel,
      txHex: originalHex,
      error: { code: LiFiErrorCode.TransactionCanceled },
    })

    const retryUpdates = recordRouteUpdates()
    const retried = await settleWithFakeTime(
      page.resumeRoute(failed, { updateRouteHook: retryUpdates.hook })
    )

    // prepareRestart drops the final action: a new quote, one new signature.
    expect(network.quotes).toHaveLength(2)
    expect(page.signPsbt.mock.calls).toEqual([
      signCallOf(page, network.quotes[0]),
      signCallOf(page, network.quotes[1]),
    ])
    // #507 behaviour: "Try again" resends nothing of the final action: the
    // only new send is exactly the bytes of the new signature.
    const signed = await signedPsbts(page)
    expect(network.sent).toEqual(signed.map(finalizedHexOf))
    expect(retryUpdates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      ...AFTER_THE_WAIT,
    ])
    expectBridgeDone(retried, txidOf(network.sent[1]))
  })

  it('resends the stored bytes within the cap after an unknown send failure (timeout), and never signs again', async () => {
    const page = await openPage(network)
    const updates = recordRouteUpdates()
    network.failNextSend = 'timeout'
    const startedAt = Date.now()
    const error = await settleWithFakeTime(
      page.executeRoute(buildRoute(page.walletAddress), {
        updateRouteHook: updates.hook,
      })
    ).then(
      () => undefined,
      (reason: unknown) => reason as { code?: unknown }
    )

    // bigmi's 10 s request timeout: an unknown outcome, the bytes are kept
    // and the failure is not final.
    expect(Date.now() - startedAt).toBe(10_000)
    expect(error?.code).toBe(LiFiErrorCode.InternalError)
    expect(page.signPsbt.mock.calls).toEqual([
      signCallOf(page, network.quotes[0]),
    ])
    const [signed] = await signedPsbts(page)
    const [lost] = network.lostSends
    expect(network.lostSends).toEqual([finalizedHexOf(signed)])
    const failed = updates.snapshots.at(-1) as RouteExtended
    expect(stepOf(failed).execution?.status).toBe('FAILED')
    expect(crossChainOf(failed)).toMatchObject({
      status: 'FAILED',
      txHex: lost,
      txHash: txidOf(lost),
      error: { code: LiFiErrorCode.InternalError },
    })
    expect(crossChainOf(failed)?.txFinal).toBeUndefined()
    expect(network.sent).toEqual([])

    const retryUpdates = recordRouteUpdates()
    const answers = recordSendAnswers()
    const before = network.rpcMethods.length
    const retried = await settleWithFakeTime(
      page.resumeRoute(failed, { updateRouteHook: retryUpdates.hook })
    )

    // "Try again" within MAX_RESEND_AGE_MS: the kept action is re-checked,
    // the wait task resends the stored bytes once and the node takes them.
    expect(Date.now() - startedAt).toBeLessThan(MAX_RESEND_AGE_MS)
    expect(page.signPsbt).toHaveBeenCalledTimes(1)
    expect(network.stepTransactionRequests).toHaveLength(1)
    expect(network.sent).toEqual([lost])
    expect(answers).toEqual([txidOf(lost)])
    expect(network.rpcMethods.slice(before)).toEqual([
      'sendrawtransaction',
      'getblockcount',
      'getrawtransaction',
      'getblockstats',
    ])
    expect(retryUpdates.changes).toEqual([
      'CROSS_CHAIN:PENDING',
      ...AFTER_THE_WAIT,
    ])
    expectBridgeDone(retried, txidOf(lost))
  })
})
