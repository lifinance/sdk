import type { Token } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TronAddressZero } from '../utils/isZeroAddress.js'

const callTronRpcsWithRetry = vi.fn()
vi.mock('../rpc/callTronRpcsWithRetry.js', () => ({
  callTronRpcsWithRetry: (...args: unknown[]) => callTronRpcsWithRetry(...args),
}))
// No multicall contract, so every token takes the per-token RPC path.
vi.mock('./getMulticallAddress.js', () => ({
  getMulticallAddress: async () => undefined,
}))

const { getTronBalance } = await import('./getTronBalance.js')

const WALLET = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
const OTHER_WALLET = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7'
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

const token = (address: string): Token => ({
  chainId: 728126428,
  address,
  symbol: 'TKN',
  decimals: 6,
  name: 'Token',
  priceUSD: '0',
})

// A fake TronWeb whose native and TRC-20 balance reads answer per wallet.
const fakeTronWeb = (
  balancesByWallet: Record<string, { trx: number; usdt: string }>
) => ({
  fullNode: { host: 'https://tron.example' },
  trx: {
    getBalance: (wallet: string) =>
      Promise.resolve(balancesByWallet[wallet].trx),
    getCurrentBlock: () =>
      Promise.resolve({ block_header: { raw_data: { number: 7 } } }),
  },
  contract: () => ({
    at: () =>
      Promise.resolve({
        balanceOf: (wallet: string) => ({
          call: () => Promise.resolve(balancesByWallet[wallet].usdt),
        }),
      }),
  }),
})

// Route the action's callTronRpcsWithRetry(client, fn) through the fake
// TronWeb, so the real per-token logic runs against deterministic data.
const driveWith = (tronWeb: object): void => {
  callTronRpcsWithRetry.mockImplementation(
    (_client: unknown, fn: (tronWeb: object) => Promise<unknown>) => fn(tronWeb)
  )
}

describe('getTronBalance — concurrent wallets', () => {
  beforeEach(() => {
    callTronRpcsWithRetry.mockReset()
  })

  // The balance reads are deduplicated while in flight. Two wallets read at
  // the same time — a portfolio with two addresses, or two users on one
  // server — must each get their own balances.
  it('keeps concurrent reads for different wallets apart', async () => {
    driveWith(
      fakeTronWeb({
        [WALLET]: { trx: 1000, usdt: '500' },
        [OTHER_WALLET]: { trx: 2000, usdt: '700' },
      })
    )
    const tokens = [token(TronAddressZero), token(USDT)]

    const [first, second] = await Promise.all([
      getTronBalance({} as never, WALLET, tokens),
      getTronBalance({} as never, OTHER_WALLET, tokens),
    ])

    expect(first.map((balance) => balance.amount)).toEqual([1000n, 500n])
    expect(second.map((balance) => balance.amount)).toEqual([2000n, 700n])
  })
})
