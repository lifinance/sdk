import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildNetworkRoute,
  buildNetworkStep,
  createFakeNetwork,
  DESTINATION_CHAIN,
  type FakeNetwork,
  openNetworkPage,
  SOURCE_CHAIN_ID,
  USDC,
  USDT,
} from './network.mock.js'

let network: FakeNetwork

beforeEach(() => {
  network = createFakeNetwork({ receivedAmount: () => '1487654' })
  vi.stubGlobal('fetch', network.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(network.unknown).toEqual([])
})

// JUMPER-FRONT-CH: the wallet is on the step chain, but `client.chain` is old.
describe('a wallet client with a stale chain, through the real viem actions', () => {
  it('signs the approval and the swap for the step chain, with no chain switch', async () => {
    const page = openNetworkPage({
      network,
      clientChain: DESTINATION_CHAIN,
      route: buildNetworkRoute([
        buildNetworkStep({
          id: 'erc20-swap',
          fromToken: USDC,
          toToken: USDT,
          fromAmount: '1500000',
          toAmount: '1490000',
          tool: 'paraswap',
        }),
      ]),
    })

    await page.run()

    expect(network.signed.map(({ chainId }) => chainId)).toEqual([
      SOURCE_CHAIN_ID,
      SOURCE_CHAIN_ID,
    ])
    expect(page.switches).toEqual([])
    expect(page.latest().steps[0].execution?.status).toBe('DONE')
  })
})
