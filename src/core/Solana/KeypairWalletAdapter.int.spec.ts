import { ChainType } from '@lifi/types'

import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, isSolana, Solana } from '../../../src/index.js'
import { generateTestKeypair } from '../../tests/solana.js'
import { KeypairWallet } from './KeypairWalletAdapter.js'

const retryTimes = 2
const timeout = 30000

const { privateKey, publicKey } = generateTestKeypair()
const testWallet = new KeypairWallet(privateKey)

const client = createClient({
  integrator: 'lifi-sdk-test',
})

beforeAll(() => {
  client.setProviders([
    Solana({
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
      expect(isSolana(provider)).toBe(true)

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
