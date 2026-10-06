import { ChainId, type SDKClient, type Token } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'

// Two tenants, each with its own Sui RPC URL and API key. Tenant A's node
// fails every balance listing; tenant B's node answers.
const { TENANT_A, TENANT_B, SUI, requests } = vi.hoisted(() => ({
  TENANT_A: 'https://tenant-a.test/keyA',
  TENANT_B: 'https://tenant-b.test/keyB',
  SUI: '0x2::sui::SUI',
  requests: [] as string[],
}))

vi.mock('@mysten/sui/grpc', () => ({
  SuiGrpcClient: class {
    readonly core: object
    readonly ledgerService: object
    constructor({ baseUrl }: { baseUrl: string }) {
      this.core = {
        listBalances: async () => {
          requests.push(`listBalances ${baseUrl}`)
          if (baseUrl === TENANT_A) {
            throw new Error('Tenant A node is unavailable')
          }
          return {
            balances: [{ coinType: SUI, balance: '700' }],
            hasNextPage: false,
            cursor: null,
          }
        },
      }
      this.ledgerService = {
        getServiceInfo: async () => {
          requests.push(`getServiceInfo ${baseUrl}`)
          return { response: { checkpointHeight: 42n } }
        },
      }
    }
  },
}))

import { getSuiBalance } from './getSuiBalance.js'

const WALLET =
  '0x1111111111111111111111111111111111111111111111111111111111111111'

const sdkClient = (rpcUrls: string[]) =>
  ({ getRpcUrlsByChainId: async () => rpcUrls }) as unknown as SDKClient

const sui: Token = {
  chainId: ChainId.SUI,
  address: SUI,
  symbol: 'SUI',
  decimals: 9,
  name: 'Sui',
  priceUSD: '0',
}

describe('getSuiBalance — SDK clients with different RPC URLs', () => {
  // The reads are deduplicated while in flight. Two SDK clients that read the
  // same wallet at the same time must not share a request: it would reach one
  // tenant's URL and API key for the other tenant.
  it('sends each read to the RPC URLs of its own SDK client', async () => {
    const [tenantA, tenantB] = await Promise.all([
      getSuiBalance(sdkClient([TENANT_A]), WALLET, [sui]),
      getSuiBalance(sdkClient([TENANT_B]), WALLET, [sui]),
    ])

    expect([...requests].sort()).toEqual([
      `getServiceInfo ${TENANT_A}`,
      `getServiceInfo ${TENANT_B}`,
      `listBalances ${TENANT_A}`,
      `listBalances ${TENANT_B}`,
    ])
    expect(tenantA[0].amount).toBeUndefined()
    expect(tenantB[0]).toMatchObject({ amount: 700n, blockNumber: 42n })
  })
})
