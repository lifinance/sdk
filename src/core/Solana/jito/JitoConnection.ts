import {
  type Cluster,
  Connection,
  type VersionedTransaction,
} from '@solana/web3.js'
import { uint8ArrayToBase64 } from '../../../utils/uint8ArrayToBase64.js'
import { JITO_TIP_ACCOUNTS } from './constants.js'

export type SimulateBundleResult = {
  value: {
    summary: 'succeeded' | { failed: { error: any; tx_signature: string } }
    transactionResults: Array<{
      err: any
      logs: string[] | null
      unitsConsumed?: number
    }>
  }
}

/**
 * Extended Connection class with Jito bundle support
 * Adds simulateBundle, sendBundle, and getTipAccounts methods
 */
export class JitoConnection extends Connection {
  private tipAccountsCache: string[] | null = null
  private cluster: Cluster

  constructor(endpoint: string, cluster: Cluster = 'mainnet-beta') {
    super(endpoint)
    this.cluster = cluster
  }

  /**
   * Makes a direct RPC request to the Jito-enabled endpoint
   */
  private async rpcRequest<T>(method: string, params: any[]): Promise<T> {
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    })

    const data = await response.json()
    if (data.error) {
      throw new Error(`Jito RPC Error: ${data.error.message}`)
    }
    return data.result
  }

  /**
   * Serialize a transaction to base64 for RPC submission
   */
  private serializeTransaction(transaction: VersionedTransaction): string {
    return uint8ArrayToBase64(transaction.serialize())
  }

  /**
   * Get the tip accounts from the Jito endpoint
   * Results are cached to avoid repeated RPC calls
   */
  async getTipAccounts(): Promise<string[]> {
    if (this.tipAccountsCache) {
      return this.tipAccountsCache
    }

    try {
      const accounts = await this.rpcRequest<string[]>('getTipAccounts', [])
      this.tipAccountsCache = accounts
      return accounts
    } catch (error) {
      const fallbackAccounts = JITO_TIP_ACCOUNTS[this.cluster]
      console.warn(
        `Failed to fetch tip accounts from RPC, using ${this.cluster} fallback:`,
        error
      )
      return fallbackAccounts
    }
  }

  /**
   * Get a random Jito tip account to reduce contention
   */
  async getRandomTipAccount(): Promise<string> {
    const accounts = await this.getTipAccounts()
    return accounts[Math.floor(Math.random() * accounts.length)]
  }

  /**
   * Simulate a bundle before sending it
   * @param bundle - Array of signed transactions
   * @returns Simulation result
   */
  async simulateBundle(
    bundle: VersionedTransaction[]
  ): Promise<SimulateBundleResult> {
    const encodedTransactions = bundle.map((tx) =>
      this.serializeTransaction(tx)
    )
    return this.rpcRequest<SimulateBundleResult>('simulateBundle', [
      { encodedTransactions },
    ])
  }

  /**
   * Send a bundle to the Jito block engine
   * @param bundle - Array of signed transactions
   * @returns Bundle UUID
   */
  async sendBundle(bundle: VersionedTransaction[]): Promise<string> {
    const encodedTransactions = bundle.map((tx) =>
      this.serializeTransaction(tx)
    )
    return this.rpcRequest<string>('sendBundle', [encodedTransactions])
  }
}
