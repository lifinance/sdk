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
 * Makes a direct RPC request to an endpoint
 *
 */
async function rpcRequest<T>(
  endpoint: string,
  method: string,
  params: any[]
): Promise<T> {
  const response = await fetch(endpoint, {
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
  if (!response.ok) {
    throw new Error(`Jito RPC Error: ${response.status} ${response.statusText}`)
  }
  const data = await response.json()
  if (data.error) {
    throw new Error(`Jito RPC Error: ${data.error.message}`)
  }
  return data.result
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
   * Check if an RPC endpoint supports Jito bundles
   * @param rpcUrl - The RPC endpoint URL to check
   * @returns true if the endpoint supports Jito bundle methods
   */
  static async isJitoRpc(rpcUrl: string): Promise<boolean> {
    try {
      // method exists if the request is successfull and doesn't throw an error
      await rpcRequest(rpcUrl, 'getTipAccounts', [])
      return true
    } catch {
      return false
    }
  }

  /**
   * Makes a direct RPC request to the Jito-enabled endpoint
   */
  protected async rpcRequest<T>(method: string, params: any[]): Promise<T> {
    return rpcRequest(this.rpcEndpoint, method, params)
  }

  /**
   * Serialize a transaction to base64 for RPC submission
   */
  private serializeTransaction(transaction: VersionedTransaction): string {
    return uint8ArrayToBase64(transaction.serialize())
  }

  /**
   * Get the tip accounts from the Jito endpoint, using fallbacks if results are empty
   * Results are cached to avoid repeated RPC calls
   */
  async getTipAccounts(): Promise<string[]> {
    if (this.tipAccountsCache) {
      return this.tipAccountsCache
    }

    try {
      const accounts = await this.rpcRequest<string[]>('getTipAccounts', [])
      if (!accounts.length) {
        throw new Error('RPC has not tip accounts')
      }
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
