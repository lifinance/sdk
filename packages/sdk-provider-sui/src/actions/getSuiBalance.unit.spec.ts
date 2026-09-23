import { ChainId, type Token } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SuiTokenShortAddress } from '../types.js'

const callSuiWithRetry = vi.fn()
vi.mock('../client/suiClient.js', () => ({
  callSuiWithRetry: (...args: unknown[]) => callSuiWithRetry(...args),
}))

const { getSuiBalance } = await import('./getSuiBalance.js')

const WALLET =
  '0x1111111111111111111111111111111111111111111111111111111111111111'
const OTHER_WALLET =
  '0x2222222222222222222222222222222222222222222222222222222222222222'
const USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

const token = (address: string): Token => ({
  chainId: ChainId.SUI,
  address,
  symbol: 'TKN',
  decimals: 6,
  name: 'Token',
  priceUSD: '0',
})

// A fake Sui client whose balance listing answers for the requested owner.
const fakeSuiClient = (
  balancesByOwner: Record<string, { coinType: string; balance: string }[]>
) => ({
  core: {
    listBalances: ({ owner }: { owner: string }) =>
      Promise.resolve({
        balances: balancesByOwner[owner] ?? [],
        hasNextPage: false,
        cursor: null,
      }),
  },
  ledgerService: {
    getServiceInfo: () =>
      Promise.resolve({ response: { checkpointHeight: 42n } }),
  },
})

// Route the action's callSuiWithRetry(client, fn) through the fake client, so
// the real aggregation logic runs against deterministic data.
const driveWith = (suiClient: object): void => {
  callSuiWithRetry.mockImplementation(
    (_client: unknown, fn: (suiClient: object) => Promise<unknown>) =>
      fn(suiClient)
  )
}

describe('getSuiBalance', () => {
  beforeEach(() => {
    callSuiWithRetry.mockReset()
  })

  // The balance listing is deduplicated while in flight. Two wallets read at
  // the same time — a portfolio with two addresses, or two users on one
  // server — must each get their own balances.
  it('keeps concurrent reads for different wallets apart', async () => {
    driveWith(
      fakeSuiClient({
        [WALLET]: [
          { coinType: SuiTokenShortAddress, balance: '1000' },
          { coinType: USDC, balance: '500' },
        ],
        [OTHER_WALLET]: [
          { coinType: SuiTokenShortAddress, balance: '2000' },
          { coinType: USDC, balance: '700' },
        ],
      })
    )
    const tokens = [token(SuiTokenShortAddress), token(USDC)]

    const [first, second] = await Promise.all([
      getSuiBalance({} as never, WALLET, tokens),
      getSuiBalance({} as never, OTHER_WALLET, tokens),
    ])

    expect(first.map((balance) => balance.amount)).toEqual([1000n, 500n])
    expect(second.map((balance) => balance.amount)).toEqual([2000n, 700n])
  })
})
