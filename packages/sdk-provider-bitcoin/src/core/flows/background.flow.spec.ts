import { ChainId, type RouteExtended } from '@lifi/sdk'
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

describe('Bitcoin background execution', () => {
  it('pauses in core PrepareTransactionTask without the wallet; a foreground resume signs once and completes', async () => {
    const page = await openPage(network)
    const updates = recordRouteUpdates()

    const paused = await page.executeRoute(buildRoute(page.walletAddress), {
      updateRouteHook: updates.hook,
      executeInBackground: true,
    })

    // main: a background run pauses in core PrepareTransactionTask, after
    // the balance read and the quote, before the sign task: the Bitcoin
    // sign task has no allowUserInteraction check (spec §1).
    expect(page.signPsbt).not.toHaveBeenCalled()
    expect(network.sent).toEqual([])
    expect(network.balanceReads).toEqual([page.walletAddress])
    expect(network.rpcMethods).toEqual(['getblockcount'])
    expect(network.stepTransactionRequests).toHaveLength(1)
    expect(network.quotes).toHaveLength(1)
    expect(network.statusRequests).toEqual([])
    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
    ])
    expect(stepOf(paused).execution?.status).toBe('ACTION_REQUIRED')
    expect(
      stepOf(paused).execution?.actions.map(
        ({ type, status, chainId, txHash }) => ({
          type,
          status,
          chainId,
          txHash,
        })
      )
    ).toEqual([
      {
        type: 'CROSS_CHAIN',
        status: 'ACTION_REQUIRED',
        chainId: ChainId.BTC,
        txHash: undefined,
      },
    ])

    // Storage holds the paused route, with the first quote.
    const stored = updates.snapshots.at(-1)
    expect(stored).toBeDefined()
    expect(stored).toEqual(JSON.parse(JSON.stringify(paused)))
    expect(stepOf(stored as RouteExtended).transactionRequest?.data).toBe(
      network.quotes[0]
    )

    // The user opens the route: a foreground resume of the stored route.
    const foregroundUpdates = recordRouteUpdates()
    const resumed = await page.resumeRoute(stored as RouteExtended, {
      updateRouteHook: foregroundUpdates.hook,
    })

    // main: the pause stopped the route, so resumeRoute runs core
    // prepareRestart, which drops the stored transactionRequest. The
    // resume asks /advanced/stepTransaction again and signs only the new
    // quote, once; the first quote is never signed. A paused background
    // run costs one quote request that is never used (characterized).
    expect(network.stepTransactionRequests).toHaveLength(2)
    expect(network.quotes).toHaveLength(2)
    expect(page.signPsbt.mock.calls).toEqual([
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
    // The money call: one sendrawtransaction with exactly the bytes the
    // signed PSBT finalizes to.
    const [signed] = await signedPsbts(page)
    expect(network.sent).toEqual([finalizedHexOf(signed)])
    const txid = txidOf(network.sent[0])

    // Every node call of both runs in order: the background run's balance
    // read, then the resume's balance read, the send, and one poll that
    // finds the transaction in a block at once, and the block's height.
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
    expect(foregroundUpdates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])

    const execution = stepOf(resumed).execution
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
