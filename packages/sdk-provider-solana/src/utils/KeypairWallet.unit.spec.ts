import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateTestKeypair } from './KeypairWallet.unit.helpers.js'
import { KeypairWalletAdapter } from './KeypairWalletAdapter.js'

const createWallet = async ({
  secretKey,
  connect = false,
}: {
  secretKey?: string
  connect?: boolean
} = {}) => {
  const secret = secretKey ?? (await generateTestKeypair()).secretKey
  const wallet = new KeypairWalletAdapter(secret)
  if (connect) {
    await wallet.connect()
  }
  return { wallet }
}

const {
  encodeSpy,
  assertIsTransactionWithinSizeLimitMock,
  assertIsTransactionWithBlockhashLifetimeMock,
  createKeyPairSignerFromBytesMock,
  signTransactionsMock,
  getTransactionCodecMock,
  getBase64EncodedWireTransactionMock,
} = vi.hoisted(() => {
  const encodeSpy = vi.fn<(value: string) => void>()
  const assertIsTransactionWithinSizeLimitMock = vi.fn()
  const assertIsTransactionWithBlockhashLifetimeMock = vi.fn()
  const createKeyPairSignerFromBytesMock = vi.fn()
  const signTransactionsMock = vi.fn()
  const getTransactionCodecMock = vi.fn()
  const getBase64EncodedWireTransactionMock = vi.fn()

  return {
    encodeSpy,
    assertIsTransactionWithinSizeLimitMock,
    assertIsTransactionWithBlockhashLifetimeMock,
    createKeyPairSignerFromBytesMock,
    signTransactionsMock,
    getTransactionCodecMock,
    getBase64EncodedWireTransactionMock,
  }
})

vi.mock('@solana/kit', async () => {
  const actual =
    await vi.importActual<typeof import('@solana/kit')>('@solana/kit')
  return {
    ...actual,
    assertIsTransactionWithinSizeLimit: assertIsTransactionWithinSizeLimitMock,
    assertIsTransactionWithBlockhashLifetime:
      assertIsTransactionWithBlockhashLifetimeMock,
    createKeyPairSignerFromBytes: createKeyPairSignerFromBytesMock,
    getTransactionCodec: getTransactionCodecMock,
    getBase64EncodedWireTransaction: getBase64EncodedWireTransactionMock,
    getBase58Codec: () => {
      const codec = actual.getBase58Codec()
      return {
        ...codec,
        encode(...args: Parameters<typeof codec.encode>) {
          encodeSpy(args[0] as string)
          return codec.encode(...args)
        },
      }
    },
  }
})

vi.mock('./base64ToUint8Array.js', () => ({
  base64ToUint8Array: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

const exportKeyMock = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)

describe('KeypairWalletAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: {
          exportKey: exportKeyMock,
        },
      },
      configurable: true,
    })

    createKeyPairSignerFromBytesMock.mockResolvedValue({
      address: 'test-address',
      keyPair: {
        publicKey: {} as CryptoKey,
      },
      signTransactions: signTransactionsMock,
    })

    signTransactionsMock.mockResolvedValue([
      {
        'test-address': new Uint8Array(64),
      },
    ])

    getTransactionCodecMock.mockReturnValue({
      decode: vi.fn((bytes: Uint8Array) => ({ decoded: true, bytes })),
    })

    getBase64EncodedWireTransactionMock.mockReturnValue(
      'base64EncodedTransaction'
    )
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('constructor validation', () => {
    it('throws when private key is empty', () => {
      expect(() => new KeypairWalletAdapter('')).toThrow(
        'Private key is required'
      )
    })

    it('throws when private key cannot be decoded', () => {
      expect(() => new KeypairWalletAdapter('not-base58')).toThrow(
        'Invalid private key format'
      )
      expect(encodeSpy).toHaveBeenCalledTimes(1)
    })

    it('throws when decoded key is not 64 bytes', () => {
      const invalidKey = '1'.repeat(32)
      expect(() => new KeypairWalletAdapter(invalidKey)).toThrow(
        'Invalid private key length. Expected 64 bytes.'
      )
    })

    it('decodes the key only once and caches the bytes', async () => {
      const { wallet } = await createWallet()
      await wallet.connect()
      await wallet.disconnect()
      await wallet.connect()

      expect(encodeSpy).toHaveBeenCalledTimes(1)
      expect(createKeyPairSignerFromBytesMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('connection lifecycle', () => {
    it('has empty accounts array before connecting', async () => {
      const { wallet } = await createWallet()

      expect(wallet.accounts).toEqual([])
    })

    it('populates accounts array after connect', async () => {
      const { wallet } = await createWallet({ connect: true })

      expect(wallet.accounts).toHaveLength(1)
      expect(wallet.accounts[0].address).toBe('test-address')
      expect(wallet.accounts[0].publicKey).toEqual(new Uint8Array([1, 2, 3, 4]))
      expect(exportKeyMock).toHaveBeenCalledTimes(1)
    })

    it('clears accounts on disconnect', async () => {
      const { wallet } = await createWallet({ connect: true })
      await wallet.disconnect()

      expect(wallet.accounts).toEqual([])
    })
  })

  describe('Wallet Standard features', () => {
    it('exposes SolanaSignTransaction feature', async () => {
      const { wallet } = await createWallet({ connect: true })

      expect(wallet.features['solana:signTransaction']).toBeDefined()
      expect(wallet.features['solana:signTransaction'].version).toBe('1.0.0')
      expect(
        wallet.features['solana:signTransaction'].supportedTransactionVersions
      ).toEqual(['legacy', 0])
    })

    it('throws when signing transaction while disconnected', async () => {
      const { wallet } = await createWallet()

      const signTransaction =
        wallet.features['solana:signTransaction'].signTransaction

      // Create a mock account since we can't access wallet.account when disconnected
      const mockAccount = {
        address: 'test-address' as any,
        publicKey: new Uint8Array(),
        chains: ['solana:mainnet'] as const,
        features: ['solana:signTransaction'] as const,
      }

      await expect(
        signTransaction({ account: mockAccount, transaction: new Uint8Array() })
      ).rejects.toThrow('Wallet is not connected')
    })

    it('signs transaction when connected', async () => {
      const { wallet } = await createWallet({ connect: true })

      const transactionBytes = new Uint8Array([1, 2, 3])
      const signTransaction =
        wallet.features['solana:signTransaction'].signTransaction

      await signTransaction({
        account: wallet.accounts[0],
        transaction: transactionBytes,
      })

      expect(signTransactionsMock).toHaveBeenCalled()
    })
  })
})
