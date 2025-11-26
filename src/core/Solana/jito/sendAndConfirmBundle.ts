import type { VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { getJitoConnections } from '../connection.js'

export type BundleResult = {
  bundleId: string
  txSignatures: string[]
}

/**
 * Send and confirm a bundle of transactions using Jito
 * Automatically selects a Jito-enabled RPC connection
 * @param signedTransactions - Array of signed transactions
 * @returns Bundle ID and transaction signatures
 */
export async function sendAndConfirmBundle(
  signedTransactions: VersionedTransaction[]
): Promise<BundleResult> {
  const jitoConnections = await getJitoConnections()

  if (jitoConnections.length === 0) {
    throw new Error(
      'No Jito-enabled RPC connection available for bundle submission'
    )
  }

  // Validate bundle requirements
  if (signedTransactions.length === 0) {
    throw new Error('Bundle must contain at least one transaction')
  }

  // Check that all transactions have the same blockhash (required for bundles)
  const firstBlockhash = signedTransactions[0].message.recentBlockhash
  const allSameBlockhash = signedTransactions.every(
    (tx) => tx.message.recentBlockhash === firstBlockhash
  )

  if (!allSameBlockhash) {
    console.warn(
      'Bundle transactions have different blockhashes:',
      signedTransactions.map((tx) => tx.message.recentBlockhash)
    )
  }

  // Try each Jito connection until one succeeds
  let lastError: Error | null = null

  for (const jitoConnection of jitoConnections) {
    try {
      // Simulate bundle first
      const simulationResult =
        await jitoConnection.simulateBundle(signedTransactions)

      if (simulationResult.value.summary !== 'succeeded') {
        const summary = simulationResult.value.summary as {
          failed: { error: any; tx_signature: string }
        }

        // Log the full simulation result for debugging
        console.error('Bundle simulation failed:', {
          summary: simulationResult.value.summary,
          transactionResults: simulationResult.value.transactionResults,
        })

        // Extract readable error message from TransactionFailure
        const errorMsg =
          summary.failed?.error?.TransactionFailure?.[1] ||
          JSON.stringify(summary.failed?.error) ||
          'Unknown simulation error'

        throw new Error(`Bundle simulation failed: ${errorMsg}`)
      }

      // Send bundle using JitoConnection method
      const bundleId = await jitoConnection.sendBundle(signedTransactions)

      // Extract transaction signatures using bs58 encoding (same as regular Solana transactions)
      const txSignatures = signedTransactions.map((tx) =>
        bs58.encode(tx.signatures[0])
      )

      return {
        bundleId,
        txSignatures,
      }
    } catch (error) {
      lastError = error as Error
      // Continue to next connection
    }
  }

  // If all connections failed, throw the last error
  throw lastError || new Error('Failed to send bundle to any Jito connection')
}
