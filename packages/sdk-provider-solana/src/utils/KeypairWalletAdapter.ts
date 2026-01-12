import {
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  getBase58Codec,
  getBase64EncodedWireTransaction,
  getTransactionCodec,
  type KeyPairSigner,
  type ReadonlyUint8Array,
} from '@solana/kit'
import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from '@solana/wallet-standard-features'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { base64ToUint8Array } from './base64ToUint8Array.js'

/**
 * This keypair wallet adapter is unsafe to use on the frontend and is only included to provide an easy way for applications to test
 * Wallet Adapter without using a third-party wallet.
 */
export class KeypairWalletAdapter implements Wallet {
  /**
   * Storing a keypair locally like this is not safe because any application using this adapter could retrieve the
   * secret key, and because the keypair will be lost any time the wallet is disconnected or the window is refreshed.
   */
  private _signer: KeyPairSigner | undefined
  private _account: WalletAccount | undefined
  private readonly _secretKeyBytes: ReadonlyUint8Array

  readonly version = '1.0.0' as const
  readonly name = 'Keypair Wallet' as const
  readonly icon =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48L3N2Zz4=' as const

  constructor(secretKeyBase58: string) {
    if (!secretKeyBase58) {
      throw new Error('Private key is required')
    }

    const base58Codec = getBase58Codec()
    let encoded: ReadonlyUint8Array
    try {
      encoded = base58Codec.encode(secretKeyBase58)
    } catch {
      throw new Error('Invalid private key format')
    }

    if (encoded.length !== 64) {
      throw new Error('Invalid private key length. Expected 64 bytes.')
    }

    this._secretKeyBytes = encoded
  }

  // Wallet Standard interface properties
  get chains() {
    return ['solana:mainnet', 'solana:devnet', 'solana:testnet'] as const
  }

  get accounts(): readonly WalletAccount[] {
    return this._account ? [this._account] : []
  }

  get features(): SolanaSignTransactionFeature {
    return {
      [SolanaSignTransaction]: {
        version: '1.0.0' as const,
        supportedTransactionVersions: ['legacy', 0] as const,
        signTransaction: this._signTransactionFeature.bind(this),
      },
    }
  }

  async connect(): Promise<void> {
    this._signer = await createKeyPairSignerFromBytes(this._secretKeyBytes)

    const publicKeyBytes = new Uint8Array(
      await crypto.subtle.exportKey('raw', this._signer.keyPair.publicKey)
    )

    this._account = {
      address: this._signer.address,
      publicKey: publicKeyBytes,
      chains: this.chains,
      features: [SolanaSignTransaction],
    }
  }

  async disconnect(): Promise<void> {
    this._signer = undefined
    this._account = undefined
  }

  // Wallet Standard feature implementations
  private async _signTransactionFeature(
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> {
    if (!this._signer) {
      throw new Error('Wallet is not connected')
    }

    const results: SolanaSignTransactionOutput[] = []

    for (const input of inputs) {
      const transaction = getTransactionCodec().decode(input.transaction)

      assertIsTransactionWithinSizeLimit(transaction)
      assertIsTransactionWithBlockhashLifetime(transaction)

      const signatureDictionaries = await this._signer.signTransactions([
        transaction,
      ])

      if (
        signatureDictionaries.length === 0 ||
        !signatureDictionaries[0][this._signer.address]
      ) {
        throw new Error('Failed to sign transaction')
      }

      const signedTransaction = getBase64EncodedWireTransaction(transaction)

      results.push({
        signedTransaction: base64ToUint8Array(signedTransaction),
      })
    }

    return results
  }
}
