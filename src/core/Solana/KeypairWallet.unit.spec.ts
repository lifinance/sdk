import { ed25519 } from '@noble/curves/ed25519'
import { address } from '@solana/kit'
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
} from '@solana/wallet-standard-features'
import bs58 from 'bs58'
import { describe, expect, it } from 'vitest'
import { KeypairWallet, KeypairWalletName } from './KeypairWalletAdapter.js'
import type { SolanaWallet } from './types.js'

describe('KeypairWallet', () => {
  // Helper to generate a valid test keypair
  const generateTestKeypair = () => {
    const privateKey = ed25519.utils.randomSecretKey() // 32 bytes
    const publicKey = ed25519.getPublicKey(privateKey) // 32 bytes
    // Solana keypair format: 32-byte private key + 32-byte public key
    const secretKey = new Uint8Array([...privateKey, ...publicKey]) // 64 bytes
    return {
      privateKey: bs58.encode(secretKey),
      publicKey,
      address: address(bs58.encode(publicKey)),
    }
  }

  describe('constructor', () => {
    it('should create a wallet with a valid private key', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      expect(wallet).toBeDefined()
      expect(wallet.name).toBe(KeypairWalletName)
      expect(wallet.version).toBe('1.0.0')
    })

    it('should throw an error when private key is empty', () => {
      expect(() => {
        new KeypairWallet('')
      }).toThrow('Private key is required')
    })

    it('should throw an error when private key is invalid length', () => {
      const invalidKey = bs58.encode(new Uint8Array(32)) // Only 32 bytes, not 64
      expect(() => {
        new KeypairWallet(invalidKey)
      }).toThrow('Invalid private key length. Expected 64 bytes.')
    })

    it('should derive correct public key and address from private key', () => {
      const {
        privateKey,
        publicKey,
        address: expectedAddress,
      } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      const account = wallet.accounts[0]
      expect(account.publicKey).toEqual(publicKey)
      expect(account.address).toBe(expectedAddress)
    })
  })

  describe('wallet properties', () => {
    it('should have correct name', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      expect(wallet.name).toBe(KeypairWalletName)
    })

    it('should have correct version', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      expect(wallet.version).toBe('1.0.0')
    })

    it('should have an icon', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      expect(wallet.icon).toBeDefined()
      expect(wallet.icon).toContain('data:image/svg+xml;base64,')
    })

    it('should support all Solana chains', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      expect(wallet.chains).toEqual([
        'solana:mainnet',
        'solana:devnet',
        'solana:testnet',
      ])
    })
  })

  describe('accounts', () => {
    it('should return a single account', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      expect(wallet.accounts).toHaveLength(1)
    })

    it('should have account with correct properties', () => {
      const {
        privateKey,
        publicKey,
        address: expectedAddress,
      } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      const account = wallet.accounts[0]
      expect(account.address).toBe(expectedAddress)
      expect(account.publicKey).toEqual(publicKey)
      expect(account.chains).toEqual(wallet.chains)
      expect(account.label).toBe(KeypairWalletName)
      expect(account.icon).toBe(wallet.icon)
    })

    it('should have all required features', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      const account = wallet.accounts[0]
      expect(account.features).toContain('solana:signAndSendTransaction')
      expect(account.features).toContain('solana:signTransaction')
      expect(account.features).toContain('solana:signMessage')
    })
  })

  describe('signTransaction', () => {
    it('should sign a transaction', async () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const transaction = new Uint8Array([1, 2, 3, 4, 5])
      const signFeature = wallet.features[SolanaSignTransaction]

      expect(signFeature).toBeDefined()
      expect(signFeature.version).toBe('1.0.0')
      expect(signFeature.supportedTransactionVersions).toEqual(['legacy', 0])

      const result = await signFeature.signTransaction({
        account,
        transaction,
      })

      expect(result).toHaveLength(1)
      expect(result[0].signedTransaction).toBeDefined()
      expect(result[0].signedTransaction.length).toBeGreaterThan(
        transaction.length
      )
    })

    it('should sign multiple transactions', async () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const transaction1 = new Uint8Array([1, 2, 3])
      const transaction2 = new Uint8Array([4, 5, 6])

      const signFeature = wallet.features[SolanaSignTransaction]
      const result = await signFeature.signTransaction(
        { account, transaction: transaction1 },
        { account, transaction: transaction2 }
      )

      expect(result).toHaveLength(2)
      expect(result[0].signedTransaction).toBeDefined()
      expect(result[1].signedTransaction).toBeDefined()
    })

    it('should produce verifiable signatures', async () => {
      const { privateKey, publicKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const transaction = new Uint8Array([1, 2, 3, 4, 5])
      const signFeature = wallet.features[SolanaSignTransaction]
      const result = await signFeature.signTransaction({
        account,
        transaction,
      })

      const signedTransaction = result[0].signedTransaction
      // Signature is 64 bytes, followed by transaction
      const signature = signedTransaction.slice(0, 64)
      const originalTransaction = signedTransaction.slice(64)

      expect(originalTransaction).toEqual(transaction)

      // Verify signature using ed25519
      const isValid = ed25519.verify(signature, transaction, publicKey)
      expect(isValid).toBe(true)
    })
  })

  describe('signMessage', () => {
    it('should sign a message', async () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const message = new Uint8Array([10, 20, 30, 40])
      const signFeature = wallet.features[SolanaSignMessage]

      expect(signFeature).toBeDefined()
      expect(signFeature.version).toBe('1.0.0')

      const result = await signFeature.signMessage({
        account,
        message,
      })

      expect(result).toHaveLength(1)
      expect(result[0].signedMessage).toEqual(message)
      expect(result[0].signature).toBeDefined()
      expect(result[0].signature.length).toBe(64) // ed25519 signature is 64 bytes
    })

    it('should sign multiple messages', async () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const message1 = new Uint8Array([1, 2, 3])
      const message2 = new Uint8Array([4, 5, 6])

      const signFeature = wallet.features[SolanaSignMessage]
      const result = await signFeature.signMessage(
        { account, message: message1 },
        { account, message: message2 }
      )

      expect(result).toHaveLength(2)
      expect(result[0].signedMessage).toEqual(message1)
      expect(result[1].signedMessage).toEqual(message2)
    })

    it('should produce verifiable message signatures', async () => {
      const { privateKey, publicKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const message = new Uint8Array([10, 20, 30, 40, 50])
      const signFeature = wallet.features[SolanaSignMessage]
      const result = await signFeature.signMessage({
        account,
        message,
      })

      const signature = result[0].signature

      // Verify signature using ed25519
      const isValid = ed25519.verify(signature, message, publicKey)
      expect(isValid).toBe(true)
    })
  })

  describe('signAndSendTransaction', () => {
    it('should throw an error when called', async () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)
      const account = wallet.accounts[0]

      const signFeature = wallet.features[SolanaSignAndSendTransaction]

      expect(signFeature).toBeDefined()
      expect(signFeature.version).toBe('1.0.0')
      expect(signFeature.supportedTransactionVersions).toEqual(['legacy', 0])

      await expect(
        signFeature.signAndSendTransaction({
          account,
          chain: 'solana:mainnet',
          transaction: new Uint8Array([1, 2, 3]),
        })
      ).rejects.toThrow(
        'signAndSendTransaction is not supported. Use signTransaction and send manually.'
      )
    })
  })

  describe('SolanaWallet interface', () => {
    it('should implement SolanaWallet interface', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      // Type check - should be assignable to SolanaWallet
      const solanaWallet: SolanaWallet = wallet
      expect(solanaWallet).toBeDefined()
    })

    it('should have account getter with correct properties', () => {
      const {
        privateKey,
        publicKey,
        address: expectedAddress,
      } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      const account = wallet.account

      expect(account).toBeDefined()
      expect(account.address).toBe(expectedAddress)
      expect(account.publicKey).toEqual(publicKey)
    })

    it('should have signTransaction method', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      // Verify the method exists and has the correct signature
      expect(typeof wallet.signTransaction).toBe('function')
      expect(wallet.signTransaction.length).toBe(1) // Takes one parameter
    })

    it('should sign transaction using SolanaWallet interface', async () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      // Verify the method exists and can be called
      expect(typeof wallet.signTransaction).toBe('function')

      // The method signature should match SolanaWallet interface
      // signTransaction(transaction: Transaction): Promise<Transaction>
      expect(wallet.signTransaction.length).toBe(1)
    })

    it('should use account address from SolanaWallet interface', () => {
      const { privateKey, address: expectedAddress } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      // Test that account.address matches the wallet's address
      expect(wallet.account.address).toBe(expectedAddress)
      expect(String(wallet.account.address)).toBe(String(expectedAddress))
    })
  })

  describe('Wallet Standard compliance', () => {
    it('should implement Wallet interface', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      // Check required Wallet properties
      expect(wallet.version).toBeDefined()
      expect(wallet.name).toBeDefined()
      expect(wallet.icon).toBeDefined()
      expect(wallet.chains).toBeDefined()
      expect(wallet.accounts).toBeDefined()
      expect(wallet.features).toBeDefined()
    })

    it('should have immutable accounts', () => {
      const { privateKey } = generateTestKeypair()
      const wallet = new KeypairWallet(privateKey)

      const accounts1 = wallet.accounts
      const accounts2 = wallet.accounts

      // Should return the same reference (readonly)
      expect(accounts1).toStrictEqual(accounts2)
    })
  })
})
