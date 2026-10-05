import { version as bigmiVersion } from '@bigmi/core'
import { ChainId, LiFiErrorCode, type RouteExtended } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARB_EXPLORER_URL,
  BRIDGE_RECEIVED_AMOUNT,
  BTC_EXPLORER_URL,
  buildRoute,
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
  rejectNextSignature,
  signedPsbts,
  stepOf,
  txidOf,
  USER_REJECTION_MESSAGE,
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

describe('Bitcoin user rejection', () => {
  it('fails with SignatureRejected and sends nothing; "Try again" asks the wallet again and completes', async () => {
    const page = await openPage(network)
    const updates = recordRouteUpdates()
    rejectNextSignature(page)

    const error = await page
      .executeRoute(buildRoute(page.walletAddress), {
        updateRouteHook: updates.hook,
      })
      .then(
        () => undefined,
        (reason: unknown) => reason as { code?: unknown }
      )

    expect(error?.code).toBe(LiFiErrorCode.SignatureRejected)
    // The wallet was asked once, with the quoted PSBT, unchanged.
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
    // Nothing reached the node but the balance read's block count.
    expect(network.sent).toEqual([])
    expect(network.rpcMethods).toEqual(['getblockcount'])
    expect(network.balanceReads).toEqual([page.walletAddress])
    expect(network.statusRequests).toEqual([])
    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:FAILED',
    ])
    const failed = updates.snapshots.at(-1) as RouteExtended
    // main: the stored error message wraps the rejection twice, with
    // bigmi's "Version:" footer twice. The fake wallet throws bigmi's
    // UserRejectedRequestError (code -32000); bigmi's buildRequest matches
    // code -32000 before its BaseError passthrough and wraps the full
    // message in a new UserRejectedRequestError; parseBitcoinErrors keeps
    // that full message (characterized).
    const rejection = {
      message: [
        `UserRejectedRequestError:  UserRejectedRequestError:  ${USER_REJECTION_MESSAGE}`,
        '',
        `Version: bigmi@${bigmiVersion}`,
        '',
        `Version: bigmi@${bigmiVersion}`,
      ].join('\n'),
      code: LiFiErrorCode.SignatureRejected,
    }
    expect(stepOf(failed).execution?.status).toBe('FAILED')
    expect(stepOf(failed).execution?.error).toEqual(rejection)
    expect(stepOf(failed).execution?.actions).toEqual([
      {
        type: 'CROSS_CHAIN',
        status: 'FAILED',
        chainId: ChainId.BTC,
        error: rejection,
      },
    ])
    expect(stepOf(failed).execution?.actions[0].txHash).toBeUndefined()
    expect(network.balanceOf(page.walletAddress)).toBe(WALLET_BALANCE)

    // "Try again": the widget resumes the route it stored.
    const retryUpdates = recordRouteUpdates()
    const retried = await page.resumeRoute(failed, {
      updateRouteHook: retryUpdates.hook,
    })

    // The wallet is asked again, with a new quote (prepareRestart drops the
    // transaction request), and the route completes with one send.
    expect(network.stepTransactionRequests).toHaveLength(2)
    expect(network.quotes).toHaveLength(2)
    expect(page.signPsbt.mock.calls).toHaveLength(2)
    expect(page.signPsbt.mock.calls[1]).toEqual([
      {
        psbt: network.quotes[1],
        inputsToSign: [
          { address: page.walletAddress, sigHash: 1, signingIndexes: [0] },
        ],
        finalize: false,
      },
    ])
    const [signed] = await signedPsbts(page)
    expect(network.sent).toEqual([finalizedHexOf(signed)])
    const txid = txidOf(network.sent[0])

    // Every node call of both runs in order: the first run's balance read,
    // then the retry's balance read, the send, and one poll that finds the
    // transaction in a block at once, and the block's height.
    expect(network.rpcMethods).toEqual([
      'getblockcount',
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
        txHash: txid,
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
    // The money moved once: the wallet holds only the change of one send.
    expect(network.balanceOf(page.walletAddress)).toBe(
      WALLET_BALANCE - BigInt(FROM_AMOUNT) - QUOTE_FEE
    )
  })
})
