import { ed25519 } from '@noble/curves/ed25519'
import type {
  SignerWalletAdapter,
  WalletName,
} from '@solana/wallet-adapter-base'
import {
  BaseSignerWalletAdapter,
  isVersionedTransaction,
  WalletConfigError,
  WalletNotConnectedError,
  WalletReadyState,
} from '@solana/wallet-adapter-base'
import type {
  Transaction,
  TransactionVersion,
  VersionedTransaction,
} from '@solana/web3.js'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

export const KeypairWalletName =
  'Keypair Wallet' as WalletName<'Keypair Wallet'>

/**
 * This keypair wallet adapter is unsafe to use on the frontend and is only included to provide an easy way for applications to test
 * Wallet Adapter without using a third-party wallet.
 */
export class KeypairWalletAdapter
  extends BaseSignerWalletAdapter
  implements SignerWalletAdapter
{
  name = KeypairWalletName
  url = 'https://github.com/anza-xyz/wallet-adapter'
  icon = ''
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set([
    'legacy',
    0,
  ])

  /**
   * Storing a keypair locally like this is not safe because any application using this adapter could retrieve the
   * secret key, and because the keypair will be lost any time the wallet is disconnected or the window is refreshed.
   */
  private _keypair: Keypair | undefined

  constructor(privateKey: string) {
    if (!privateKey) {
      throw new WalletConfigError()
    }
    super()
    this._keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
  }

  get connecting() {
    return false
  }

  get publicKey() {
    return this._keypair?.publicKey || null
  }

  get readyState() {
    return WalletReadyState.Loadable
  }

  async connect(privateKey?: string): Promise<void> {
    if (!privateKey) {
      throw new WalletConfigError()
    }
    this._keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
  }

  async disconnect(): Promise<void> {
    this._keypair = undefined
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    if (!this._keypair) {
      throw new WalletNotConnectedError()
    }

    if (isVersionedTransaction(transaction)) {
      transaction.sign([this._keypair])
    } else {
      transaction.partialSign(this._keypair)
    }

    return transaction
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._keypair) {
      throw new WalletNotConnectedError()
    }

    return ed25519.sign(message, this._keypair.secretKey.slice(0, 32))
  }
}
