import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeypairWalletAdapter } from './KeypairWalletAdapter.js'
import { generateTestKeypair } from './test.js'

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
  createSignableMessageMock,
  createKeyPairSignerFromBytesMock,
  signTransactionsMock,
  signMessagesMock,
} = vi.hoisted(() => {
  const encodeSpy = vi.fn<(value: string) => void>()
  const assertIsTransactionWithinSizeLimitMock = vi.fn()
  const assertIsTransactionWithBlockhashLifetimeMock = vi.fn()
  const createSignableMessageMock = vi.fn((message: Uint8Array) => ({
    message,
  }))
  const createKeyPairSignerFromBytesMock = vi.fn()
  const signTransactionsMock = vi.fn()
  const signMessagesMock = vi.fn()

  return {
    encodeSpy,
    assertIsTransactionWithinSizeLimitMock,
    assertIsTransactionWithBlockhashLifetimeMock,
    createSignableMessageMock,
    createKeyPairSignerFromBytesMock,
    signTransactionsMock,
    signMessagesMock,
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
    createSignableMessage: createSignableMessageMock,
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
      signMessages: signMessagesMock,
      signTransactions: signTransactionsMock,
    })

    signTransactionsMock.mockResolvedValue([
      {
        'test-address': new Uint8Array(64),
      },
    ])
    signMessagesMock.mockResolvedValue([
      {
        'test-address': new Uint8Array(64),
      },
    ])
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
    it('throws when accessing account before connecting', async () => {
      const { wallet } = await createWallet()

      expect(() => wallet.account).toThrow('Wallet is disconnected')
    })

    it('populates account after connect', async () => {
      const { wallet } = await createWallet({ connect: true })

      expect(wallet.account.address).toBe('test-address')
      expect(wallet.account.publicKey).toEqual(new Uint8Array([1, 2, 3, 4]))
      expect(exportKeyMock).toHaveBeenCalledTimes(1)
    })

    it('clears state on disconnect', async () => {
      const { wallet } = await createWallet({ connect: true })
      await wallet.disconnect()

      expect(() => wallet.account).toThrow('Wallet is disconnected')
    })
  })

  describe('signing', () => {
    it('throws when signing transaction while disconnected', async () => {
      const { wallet } = await createWallet()

      await expect(wallet.signTransaction({} as never)).rejects.toThrow(
        'Wallet is not connected'
      )
    })

    it('signs transaction when connected', async () => {
      const { wallet } = await createWallet({ connect: true })

      const transaction = { test: true } as never
      const result = await wallet.signTransaction(transaction)

      expect(result).toBe(transaction)
      expect(assertIsTransactionWithinSizeLimitMock).toHaveBeenCalledWith(
        transaction
      )
      expect(assertIsTransactionWithBlockhashLifetimeMock).toHaveBeenCalledWith(
        transaction
      )
      expect(signTransactionsMock).toHaveBeenCalledWith([transaction])
    })

    it('throws when signing message while disconnected', async () => {
      const { wallet } = await createWallet()

      await expect(
        wallet.signMessage(new Uint8Array([1, 2, 3]))
      ).rejects.toThrow('Wallet is not connected')
    })

    it('signs message when connected', async () => {
      const { wallet } = await createWallet({ connect: true })

      const message = new Uint8Array([4, 5, 6])
      await wallet.signMessage(message)

      expect(createSignableMessageMock).toHaveBeenCalledWith(message)
      expect(signMessagesMock).toHaveBeenCalledWith([
        {
          message,
        },
      ])
    })
  })
})
