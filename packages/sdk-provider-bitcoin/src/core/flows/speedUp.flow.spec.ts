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
  SPEED_UP_EXTRA_FEE,
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

describe('Bitcoin bridge with a repriced replacement (speed-up)', () => {
  it('follows the replacement txid to the block and to /status DONE without a second signature or send', async () => {
    // bigmi retries `getrawtransaction` of the replaced transaction every
    // 3 s (10 times) before it scans the block: fake time.
    vi.useFakeTimers()
    const page = await openPage(network)
    const updates = recordRouteUpdates()
    // The user speeds the transaction up in the wallet app right after the
    // send: same outputs, a smaller change, a higher fee.
    network.replaceNextSend = 'repriced'

    const route = await settleWithFakeTime(
      page.executeRoute(buildRoute(page.walletAddress), {
        updateRouteHook: updates.hook,
      })
    )

    // One signature and one send: the replacement is the wallet's own
    // broadcast, not the SDK's. The wallet signs the quoted PSBT, unchanged.
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
    const [signed] = await signedPsbts(page)
    expect(network.sent).toEqual([finalizedHexOf(signed)])
    const original = txidOf(network.sent[0])
    expect(network.replacements).toHaveLength(1)
    const [replacement] = network.replacements
    expect(network.isMined(original)).toBe(false)
    expect(network.isMined(replacement)).toBe(true)

    // The wait found the replacement by scanning the tip block.
    expect(new Set(network.rpcMethods)).toEqual(
      new Set([
        'getblockcount',
        'sendrawtransaction',
        'getrawtransaction',
        'getblockhash',
        'getblock',
      ])
    )
    expect(
      network.rpcMethods.filter((method) => method === 'getblock')
    ).toHaveLength(1)

    // The CROSS_CHAIN hash the user sees: the original, then the
    // replacement (consecutive duplicates removed).
    const crossChainHashes = updates.snapshots
      .map(
        (snapshot) =>
          stepOf(snapshot).execution?.actions.find(
            (action) => action.type === 'CROSS_CHAIN'
          )?.txHash
      )
      .filter((hash): hash is string => hash !== undefined)
      .filter((hash, index, hashes) => hash !== hashes[index - 1])
    expect(crossChainHashes).toEqual([original, replacement])

    // The status poll asks for the replacement, the route completes.
    expect(network.statusRequests.map((query) => query.txHash)).toEqual([
      replacement,
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
    expect(execution?.toAmount).toBe(BRIDGE_RECEIVED_AMOUNT)
    expect(execution?.actions).toHaveLength(2)
    const [crossChain, receiving] = execution?.actions ?? []
    expect(crossChain).toMatchObject({
      type: 'CROSS_CHAIN',
      status: 'DONE',
      chainId: ChainId.BTC,
      txHash: replacement,
      txLink: `${BTC_EXPLORER_URL}tx/${replacement}`,
    })
    // main: txHex keeps the original bytes while txHash names the
    // replacement (characterized; the two describe different transactions).
    expect(crossChain.txHex).toBe(network.sent[0])
    expect(receiving).toMatchObject({
      type: 'RECEIVING_CHAIN',
      status: 'DONE',
      chainId: ChainId.ARB,
      txHash: destinationTxHashOf(replacement),
      txLink: `${ARB_EXPLORER_URL}tx/${destinationTxHashOf(replacement)}`,
    })
    expect(network.balanceOf(page.walletAddress)).toBe(
      WALLET_BALANCE - BigInt(FROM_AMOUNT) - QUOTE_FEE - SPEED_UP_EXTRA_FEE
    )
  })
})
