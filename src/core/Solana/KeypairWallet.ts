import { ed25519 } from '@noble/curves/ed25519'
import { address } from '@solana/kit'
import type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignAndSendTransactionMethod,
  SolanaSignMessageFeature,
  SolanaSignMessageMethod,
  SolanaSignTransactionFeature,
  SolanaSignTransactionMethod,
} from '@solana/wallet-standard-features'
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
} from '@solana/wallet-standard-features'
import type { Wallet, WalletAccount } from '@wallet-standard/core'
import bs58 from 'bs58'

export const KeypairWalletName = 'Keypair Wallet'

/**
 * This keypair wallet is unsafe to use on the frontend and is only included to provide an easy way for applications to test
 * without using a third-party wallet. It implements the Wallet Standard interface.
 */
export class KeypairWallet implements Wallet {
  readonly #privateKey: Uint8Array
  readonly #publicKey: Uint8Array
  readonly #address: string

  readonly version = '1.0.0' as const
  readonly name = KeypairWalletName
  readonly icon =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48L3N2Zz4='

  readonly chains = [
    'solana:mainnet',
    'solana:devnet',
    'solana:testnet',
  ] as const

  get accounts(): readonly WalletAccount[] {
    return [
      {
        address: this.#address,
        publicKey: this.#publicKey,
        chains: this.chains,
        features: [
          'solana:signAndSendTransaction' as const,
          'solana:signTransaction' as const,
          'solana:signMessage' as const,
        ],
        label: KeypairWalletName,
        icon: this.icon,
      },
    ]
  }

  readonly features: Wallet['features'] & {
    [SolanaSignAndSendTransaction]: SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
    [SolanaSignTransaction]: SolanaSignTransactionFeature[typeof SolanaSignTransaction]
    [SolanaSignMessage]: SolanaSignMessageFeature[typeof SolanaSignMessage]
  }

  constructor(privateKey: string) {
    if (!privateKey) {
      throw new Error('Private key is required')
    }

    const secretKey = bs58.decode(privateKey)
    if (secretKey.length !== 64) {
      throw new Error('Invalid private key length. Expected 64 bytes.')
    }

    this.#privateKey = secretKey.slice(0, 32)
    this.#publicKey = secretKey.slice(32)
    this.#address = address(bs58.encode(this.#publicKey))

    // Implement Wallet Standard features
    const signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
      return inputs.map((input) => {
        const { transaction } = input

        // Sign the transaction using ed25519
        const signature = ed25519.sign(transaction, this.#privateKey)

        return {
          signedTransaction: new Uint8Array([...signature, ...transaction]),
        }
      })
    }

    const signMessage: SolanaSignMessageMethod = async (...inputs) => {
      return inputs.map((input) => {
        const signature = ed25519.sign(input.message, this.#privateKey)
        return { signedMessage: input.message, signature }
      })
    }

    const signAndSendTransaction: SolanaSignAndSendTransactionMethod =
      async () => {
        throw new Error(
          'signAndSendTransaction is not supported. Use signTransaction and send manually.'
        )
      }

    this.features = {
      [SolanaSignTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction,
      },
      [SolanaSignMessage]: {
        version: '1.0.0',
        signMessage,
      },
      [SolanaSignAndSendTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction,
      },
    }
  }
}
