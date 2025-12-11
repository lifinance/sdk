import {
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSignableMessage,
  getBase58Codec,
  type KeyPairSigner,
  type ReadonlyUint8Array,
  type Transaction,
} from '@solana/kit'
import type { SolanaWallet, WalletAccount } from '../types.js'

/**
 * This keypair wallet adapter is unsafe to use on the frontend and is only included to provide an easy way for applications to test
 * Wallet Adapter without using a third-party wallet.
 */
export class KeypairWalletAdapter implements SolanaWallet {
  /**
   * Storing a keypair locally like this is not safe because any application using this adapter could retrieve the
   * secret key, and because the keypair will be lost any time the wallet is disconnected or the window is refreshed.
   */
  private _signer: KeyPairSigner | undefined
  private _account: WalletAccount | undefined
  private readonly _secretKeyBytes: ReadonlyUint8Array

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

  get connecting() {
    return false
  }

  get publicKey() {
    return this._signer?.keyPair.publicKey || null
  }

  get account() {
    if (!this._account) {
      throw new Error('Wallet is disconnected')
    }
    return this._account
  }

  async connect(): Promise<void> {
    this._signer = await createKeyPairSignerFromBytes(this._secretKeyBytes)

    const publicKeyBytes = new Uint8Array(
      await crypto.subtle.exportKey('raw', this._signer.keyPair.publicKey)
    )

    this._account = {
      address: this._signer.address,
      publicKey: publicKeyBytes,
    }
  }

  async disconnect(): Promise<void> {
    this._signer = undefined
    this._account = undefined
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this._signer) {
      throw new Error('Wallet is not connected')
    }

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

    return transaction
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._signer) {
      throw new Error('Wallet is not connected')
    }

    const signatureDictionaries = await this._signer.signMessages([
      createSignableMessage(message),
    ])

    const signature = signatureDictionaries[0]?.[this._signer.address]
    if (!signature) {
      throw new Error('Failed to sign message')
    }

    return signature
  }
}
