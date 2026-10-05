import { ChainId } from '@lifi/sdk'
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

describe('Bitcoin bridge (BTC → USDC on Arbitrum)', () => {
  it('signs the quoted PSBT once, sends it once, waits for a block and polls /status to DONE', async () => {
    const page = await openPage(network)
    const updates = recordRouteUpdates()

    const route = await page.executeRoute(buildRoute(page.walletAddress), {
      updateRouteHook: updates.hook,
    })

    // The wallet: one signPsbt with the quoted PSBT, unchanged (a p2wpkh
    // input needs no tapInternalKey, sighashType or redeemScript).
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
    // The money call: one sendrawtransaction with exactly the bytes the
    // signed PSBT finalizes to.
    const [signed] = await signedPsbts(page)
    expect(network.sent).toEqual([finalizedHexOf(signed)])
    const txid = txidOf(network.sent[0])

    // Every node call in order: the balance read's block count, the send,
    // then one poll of waitForTransaction that finds the transaction in a
    // block at once (emitOnBegin), and the block's height.
    expect(network.rpcMethods).toEqual([
      'getblockcount',
      'sendrawtransaction',
      'getblockcount',
      'getrawtransaction',
      'getblockstats',
    ])
    expect(network.balanceReads).toEqual([page.walletAddress])
    expect(network.stepTransactionRequests).toHaveLength(1)
    expect(network.statusRequests).toEqual([
      {
        fromChain: String(ChainId.BTC),
        fromAddress: page.walletAddress,
        toChain: String(ChainId.ARB),
        txHash: txid,
        bridge: 'thorswap',
      },
    ])

    expect(updates.changes).toEqual([
      'CROSS_CHAIN:STARTED',
      'CROSS_CHAIN:ACTION_REQUIRED',
      'CROSS_CHAIN:PENDING',
      'CROSS_CHAIN:DONE',
      'RECEIVING_CHAIN:PENDING',
      'RECEIVING_CHAIN:DONE',
    ])

    const execution = stepOf(route).execution
    expect(execution?.status).toBe('DONE')
    expect(execution?.fromAmount).toBe(FROM_AMOUNT)
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
    // The last route update is the route executeRoute returns.
    expect(updates.snapshots.at(-1)).toEqual(JSON.parse(JSON.stringify(route)))

    // On the fake chain: the transaction is in a block, and the wallet
    // holds only the change.
    expect(network.isMined(txid)).toBe(true)
    expect(network.balanceOf(page.walletAddress)).toBe(
      WALLET_BALANCE - BigInt(FROM_AMOUNT) - QUOTE_FEE
    )
  })
})
