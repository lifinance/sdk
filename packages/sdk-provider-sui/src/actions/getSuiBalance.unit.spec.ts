import { ChainId, type SDKClient, type Token } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callSuiWithRetry = vi.fn()
vi.mock('../client/suiClient.js', () => ({
  callSuiWithRetry: (...args: unknown[]) => callSuiWithRetry(...args),
}))

const { getSuiBalance } = await import('./getSuiBalance.js')

const WALLET_A =
  '0x1111111111111111111111111111111111111111111111111111111111111111'
const WALLET_B =
  '0x2222222222222222222222222222222222222222222222222222222222222222'
const TOKEN_ADDRESS = '0x3::test::TEST'

const token: Token = {
  chainId: ChainId.SUI,
  address: TOKEN_ADDRESS,
  symbol: 'TEST',
  decimals: 6,
  name: 'Test Token',
  priceUSD: '0',
}

describe('getSuiBalance', () => {
  beforeEach(() => {
    callSuiWithRetry.mockReset()
  })

  it('does not dedupe balance reads across different wallets', async () => {
    let releaseFirst!: () => void
    const firstWalletGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let listBalanceCalls = 0

    const suiClient = {
      core: {
        listBalances: async ({ owner }: { owner: string }) => {
          listBalanceCalls++
          if (owner === WALLET_A) {
            await firstWalletGate
          }
          return {
            balances: [
              {
                coinType: TOKEN_ADDRESS,
                balance: owner === WALLET_A ? '100' : '200',
              },
            ],
            hasNextPage: false,
            cursor: null,
          }
        },
      },
      ledgerService: {
        getServiceInfo: async () => ({
          response: { checkpointHeight: 123n },
        }),
      },
    }

    callSuiWithRetry.mockImplementation(
      (
        _client: SDKClient,
        fn: (client: typeof suiClient) => Promise<unknown>
      ) => fn(suiClient)
    )

    const first = getSuiBalance({} as SDKClient, WALLET_A, [token])
    const second = getSuiBalance({} as SDKClient, WALLET_B, [token])

    releaseFirst()

    const [[firstBalance], [secondBalance]] = await Promise.all([first, second])

    expect(firstBalance.amount).toBe(100n)
    expect(secondBalance.amount).toBe(200n)
    expect(listBalanceCalls).toBe(2)
  })
})
