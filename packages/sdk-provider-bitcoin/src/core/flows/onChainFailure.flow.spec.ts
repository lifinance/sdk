import { ChainId, LiFiErrorCode, type RouteExtended } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  BRIDGE_RECEIVED_AMOUNT,
  BTC_EXPLORER_URL,
  buildRoute,
  CANCEL_FEE,
  clearBigmiObservers,
  destinationTxHashOf,
  type FakeBitcoinNetwork,
  FROM_AMOUNT,
  finalizedHexOf,
  installFakeBitcoinNetwork,
  liveBigmiObservers,
  openPage,
  QUOTE_FEE,
  recordRouteUpdates,
  settleWithFakeTime,
  signedPsbts,
  stepOf,
  txidOf,
  WALLET_BALANCE,
} from './harness.mock.js'

let network: FakeBitcoinNetwork

beforeEach(() => {
  network = installFakeBitcoinNetwork()
})

afterEach(() => {
  const live = liveBigmiObservers()
  try {
    expect({ live, unexpected: network.unexpected }).toEqual({
      live: [],
      unexpected: [],
    })
  } finally {
    clearBigmiObservers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

// Main's only final on-chain failure for Bitcoin: the user cancels the
// transaction in the wallet (RBF to their own address), and bigmi reports
// the replacement as `cancelled`.
describe('Bitcoin on-chain failure: a cancelled replacement', () => {
  it('fails with TransactionCanceled; "Try again" signs and sends a new transaction', async () => {
    // bigmi retries `getrawtransaction` of the replaced transaction every
    // 3 s (10 times) before it scans the block: fake time.
    vi.useFakeTimers()
    const page = await openPage(network)
    const updates = recordRouteUpdates()
    // The user cancels the transaction in the wallet app right after the
    // send: one output back to the sender, a higher fee.
    network.replaceNextSend = 'cancelled'

    const error = await settleWithFakeTime(
      page.executeRoute(buildRoute(page.walletAddress), {
        updateRouteHook: updates.hook,
      })
    ).then(
      () => undefined,
      (reason: unknown) => reason as { code?: unknown }
    )

    expect(error?.code).toBe(LiFiErrorCode.TransactionCanceled)
    // One signature and one send: the cancel is the wallet's own
    // broadcast, not the SDK's. The wallet signs the quoted PSBT, unchanged.
    expect(network.stepTransactionRequests).toHaveLength(1)
    expect(network.quotes).toHaveLength(1)
    expect(page.signPsbt.mock.calls).toEqual([
      [
        {
          psbt: network.quotes[0],
          inputsToSign: [
            { address: page.walletAddress, sigHash: 1, signingIndexes: [0] },
          ],
          finalize: false,
        },
      ],
    ])
    const [firstSigned] = await signedPsbts(page)
    expect(network.sent).toEqual([finalizedHexOf(firstSigned)])
    const original = txidOf(network.sent[0])
    expect(network.replacements).toHaveLength(1)
    const [cancel] = network.replacements
    expect(network.isMined(original)).toBe(false)
    expect(network.isMined(cancel)).toBe(true)

    // The wait found the cancel by scanning the tip block. No /status
    // request: the wait task throws before the status poll.
    const firstRunMethods = [...network.rpcMethods]
    expect(new Set(firstRunMethods)).toEqual(
      new Set([
        'getblockcount',
        'sendrawtransaction',
        'getrawtransaction',
        'getblockhash',
        'getblock',
      ])
    )
    expect(
      firstRunMethods.filter((method) => method === 'getblock')
    ).toHaveLength(1)
    expect(network.balanceReads).toEqual([page.walletAddress])
    expect(network.statusRequests).toEqual([])

    // The CROSS_CHAIN hash the user sees: the original, then the cancel
    // (consecutive duplicates removed).
    const crossChainHashes = updates.snapshots
      .map(
        (snapshot) =>
          stepOf(snapshot).execution?.actions.find(
            (action) => action.type === 'CROSS_CHAIN'
          )?.txHash
      )
      .filter((hash): hash is string => hash !== undefined)
      .filter((hash, index, hashes) => hash !== hashes[index - 1])
    expect(crossChainHashes).toEqual([original, cancel])
    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:FAILED',
    ])
    const failed = updates.snapshots.at(-1) as RouteExtended
    expect(stepOf(failed).execution?.status).toBe('FAILED')
    expect(stepOf(failed).execution?.error?.code).toBe(
      LiFiErrorCode.TransactionCanceled
    )
    // The FAILED action names the cancelling transaction, not the original.
    expect(
      stepOf(failed).execution?.actions.map(
        ({ type, status, chainId, txHash, txLink, error }) => ({
          type,
          status,
          chainId,
          txHash,
          txLink,
          code: error?.code,
        })
      )
    ).toEqual([
      {
        type: 'CROSS_CHAIN',
        status: 'FAILED',
        chainId: ChainId.BTC,
        txHash: cancel,
        txLink: `${BTC_EXPLORER_URL}tx/${cancel}`,
        code: LiFiErrorCode.TransactionCanceled,
      },
    ])
    // main: txHex keeps the original bytes while txHash names the cancel
    // (characterized, as in the speed-up spec; the two describe different
    // transactions).
    expect(stepOf(failed).execution?.actions[0].txHex).toBe(network.sent[0])
    // The cancel returned the funds minus its fee.
    expect(network.balanceOf(page.walletAddress)).toBe(
      WALLET_BALANCE - CANCEL_FEE
    )

    // "Try again": the widget resumes the route it stored. prepareRestart
    // drops the FAILED action, so the run asks for a new quote (spending
    // the cancel's output) and signs it.
    const retryUpdates = recordRouteUpdates()
    const retried = await settleWithFakeTime(
      page.resumeRoute(failed, { updateRouteHook: retryUpdates.hook })
    )

    // The wallet signs a new PSBT: the second quote, not the first.
    expect(network.stepTransactionRequests).toHaveLength(2)
    expect(network.quotes).toHaveLength(2)
    expect(page.signPsbt.mock.calls).toEqual([
      [
        {
          psbt: network.quotes[0],
          inputsToSign: [
            { address: page.walletAddress, sigHash: 1, signingIndexes: [0] },
          ],
          finalize: false,
        },
      ],
      [
        {
          psbt: network.quotes[1],
          inputsToSign: [
            { address: page.walletAddress, sigHash: 1, signingIndexes: [0] },
          ],
          finalize: false,
        },
      ],
    ])
    expect(network.quotes[1]).not.toBe(network.quotes[0])
    // The money calls: each send is exactly the bytes its signed PSBT
    // finalizes to. The retry sends a new transaction.
    const [, secondSigned] = await signedPsbts(page)
    expect(network.sent).toEqual([
      finalizedHexOf(firstSigned),
      finalizedHexOf(secondSigned),
    ])
    const retriedTxid = txidOf(network.sent[1])
    expect(retriedTxid).not.toBe(original)
    expect(retriedTxid).not.toBe(cancel)

    // The retry's node calls in order: its balance read, the send, and one
    // poll that finds the transaction in a block at once, and the block's
    // height.
    expect(network.rpcMethods.slice(firstRunMethods.length)).toEqual([
      'getblockcount',
      'sendrawtransaction',
      'getblockcount',
      'getrawtransaction',
      'getblockstats',
    ])
    expect(network.balanceReads).toEqual([
      page.walletAddress,
      page.walletAddress,
    ])
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.BTC),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.ARB),
        txHash: retriedTxid,
        bridge: 'thorswap',
      },
    ])
    expect(retryUpdates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])

    const execution = stepOf(retried).execution
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
        txHash: retriedTxid,
        txLink: `${BTC_EXPLORER_URL}tx/${retriedTxid}`,
      },
      {
        type: 'RECEIVING_CHAIN',
        status: 'DONE',
        chainId: ChainId.ARB,
        txHash: destinationTxHashOf(retriedTxid),
        txLink: `${ARB_EXPLORER_URL}tx/${destinationTxHashOf(retriedTxid)}`,
      },
    ])
    // The money moved once: the cancel's fee, then one bridge send.
    expect(network.balanceOf(page.walletAddress)).toBe(
      WALLET_BALANCE - CANCEL_FEE - BigInt(FROM_AMOUNT) - QUOTE_FEE
    )
  })
})
