import { ChainId, type SDKClient, type Token } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callTronRpcsWithRetry = vi.fn()
const getMulticallAddress = vi.fn()

vi.mock('../rpc/callTronRpcsWithRetry.js', () => ({
  callTronRpcsWithRetry: (...args: unknown[]) => callTronRpcsWithRetry(...args),
}))

vi.mock('./getMulticallAddress.js', () => ({
  getMulticallAddress: (...args: unknown[]) => getMulticallAddress(...args),
}))

const { getTronBalance } = await import('./getTronBalance.js')

const WALLET_A = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
const WALLET_B = 'TSecondWalletAddressForDedupeTest123'
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000'
const TOKEN_ADDRESS = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj'

const nativeToken: Token = {
  chainId: ChainId.TRN,
  address: NATIVE_ADDRESS,
  symbol: 'TRX',
  decimals: 6,
  name: 'TRON',
  priceUSD: '0',
}

const token: Token = {
  chainId: ChainId.TRN,
  address: TOKEN_ADDRESS,
  symbol: 'USDT',
  decimals: 6,
  name: 'Tether USD',
  priceUSD: '0',
}

describe('getTronBalance wallet dedupe', () => {
  beforeEach(() => {
    callTronRpcsWithRetry.mockReset()
    getMulticallAddress.mockReset()
    getMulticallAddress.mockResolvedValue(undefined)
  })

  it('does not dedupe balance reads across different wallets', async () => {
    let releaseFirst!: () => void
    const firstWalletGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let nativeBalanceCalls = 0
    let tokenBalanceCalls = 0

    const tronWeb = {
      fullNode: { host: 'https://rpc.example' },
      trx: {
        getBalance: async (owner: string) => {
          nativeBalanceCalls++
          if (owner === WALLET_A) {
            await firstWalletGate
          }
          return owner === WALLET_A ? 100 : 200
        },
        getCurrentBlock: async () => ({
          block_header: { raw_data: { number: 123 } },
        }),
      },
      contract: () => ({
        at: async () => ({
          balanceOf: (owner: string) => ({
            call: async () => {
              tokenBalanceCalls++
              if (owner === WALLET_A) {
                await firstWalletGate
              }
              return owner === WALLET_A ? '1000' : '2000'
            },
          }),
        }),
      }),
    }

    callTronRpcsWithRetry.mockImplementation(
      (_client: SDKClient, fn: (client: typeof tronWeb) => Promise<unknown>) =>
        fn(tronWeb)
    )

    const first = getTronBalance({} as SDKClient, WALLET_A, [
      nativeToken,
      token,
    ])
    await Promise.resolve()
    const second = getTronBalance({} as SDKClient, WALLET_B, [
      nativeToken,
      token,
    ])

    await Promise.resolve()
    releaseFirst()

    const [firstBalances, secondBalances] = await Promise.all([first, second])

    expect(firstBalances[0].amount).toBe(100n)
    expect(firstBalances[1].amount).toBe(1000n)
    expect(secondBalances[0].amount).toBe(200n)
    expect(secondBalances[1].amount).toBe(2000n)
    expect(nativeBalanceCalls).toBe(2)
    expect(tokenBalanceCalls).toBe(2)
  })
})
