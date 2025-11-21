import { ChainType, createClient, type SDKClient } from '@lifi/sdk'
import { getBase58Encoder, type ReadonlyUint8Array } from '@solana/kit'
import { beforeAll, describe, expect, it } from 'vitest'
import { SolanaProvider } from '../SolanaProvider.js'
import { isSolanaProvider } from '../types.js'
import { KeypairWalletAdapter } from './KeypairWalletAdapter.js'
import { generateTestKeypair } from './test.js'

const retryTimes = 2
const timeout = 30000
const base58Encoder = getBase58Encoder()

const createTestClient = (wallet: KeypairWalletAdapter) => {
  const client = createClient({
    integrator: 'lifi-sdk-test',
  })

  client.setProviders([
    SolanaProvider({
      getWallet: async () => wallet,
    }),
  ])

  return client
}

type WalletScenario = {
  name: string
  setup: () => Promise<{
    secretKey: string
    expectedAddress?: string
    expectedPublicKey?: ReadonlyUint8Array
  }>
}

const runWalletScenario = ({ name, setup }: WalletScenario) => {
  describe(name, () => {
    let wallet: KeypairWalletAdapter
    let client: SDKClient
    let expectedAddress: string | undefined
    let expectedPublicKey: ReadonlyUint8Array | undefined

    beforeAll(async () => {
      const setupResult = await setup()
      wallet = new KeypairWalletAdapter(setupResult.secretKey)
      await wallet.connect()
      client = createTestClient(wallet)
      expectedAddress = setupResult.expectedAddress
      expectedPublicKey = setupResult.expectedPublicKey
    })

    it(
      'should expose the wallet through the provider',
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

        if (expectedAddress) {
          expect(wallet.account.address).toEqual(expectedAddress)
        } else {
          expect(wallet.account.address).toBeDefined()
        }

        if (expectedPublicKey) {
          expect(wallet.account.publicKey).toEqual(expectedPublicKey)
        }
      }
    )
  })
}

describe.sequential('KeypairWallet Integration Tests', () => {
  // example test secret gotten from https://solana.com/developers/cookbook/wallets/restore-keypair
  const testSecretKeyBase58 =
    '5MaiiCavjCmn9Hs1o3eznqDEhRwxo7pXiAYez7keQUviUkauRiTMD8DrESdrNjN8zd9mTmVhRvBJeg5vhyvgrAhG'
  const expectedAddress = '5pVyoAeURQHNMVU7DmfMHvCDNmTEYXWfEwc136GYhTKG'

  runWalletScenario({
    name: 'known secret key from solana cookbook',
    setup: async () => ({
      secretKey: testSecretKeyBase58,
      expectedAddress,
      expectedPublicKey: base58Encoder.encode(expectedAddress),
    }),
  })

  runWalletScenario({
    name: 'generated secret key',
    setup: async () => {
      const { secretKey, publicKey } = await generateTestKeypair()
      return {
        secretKey,
        expectedPublicKey: publicKey,
      }
    },
  })
})
