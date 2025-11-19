import { ChainType, createClient } from '@lifi/sdk'

import { beforeAll, describe, expect, it } from 'vitest'
import { SolanaProvider } from '../SolanaProvider.js'
import { isSolanaProvider } from '../types.js'
import { KeypairWalletAdapter } from './KeypairWalletAdapter.js'
import { generateTestKeypair } from './test.js'

const retryTimes = 2
const timeout = 30000

const { privateKey, publicKey } = generateTestKeypair()
const testWallet = new KeypairWalletAdapter(privateKey)

const client = createClient({
  integrator: 'lifi-sdk-test',
})

beforeAll(() => {
  client.setProviders([
    SolanaProvider({
      getWallet: async () => testWallet,
    }),
  ])
})

describe.sequential('KeypairWallet Integration Tests', () => {
  it(
    'should be accessible through config',
    { retry: retryTimes, timeout },
    async () => {
      const provider = client.getProvider(ChainType.SVM)
      expect(provider).toBeDefined()
      if (!provider) {
        throw new Error('Solana provider not found')
      }
      expect(isSolanaProvider(provider)).toBe(true)

      const executor = await provider.getStepExecutor({
        routeId: 'test-route-id',
      })

      expect(executor).toBeDefined()
      expect(executor).toHaveProperty('executeStep')
      expect(testWallet.account.address).toBeDefined()
      expect(testWallet.account.publicKey).toEqual(publicKey)
    }
  )
})
