import type { SignatureResult, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { getJitoConnections } from '../connection.js'

export type BundleResult = {
  bundleId: string
  txSignatures: string[]
  signatureResults: (SignatureResult | null)[]
}

/**
 * Send and confirm a bundle of transactions using Jito
 * Automatically selects a Jito-enabled RPC connection and polls for confirmation
 * across multiple Jito RPCs in parallel
 * @param signedTransactions - Array of signed transactions
 * @returns Bundle ID, transaction signatures, and confirmation results
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

  // Extract transaction signatures
  const txSignatures = signedTransactions.map((tx, index) => {
    if (!tx.signatures[0]) {
      throw new Error(
        `Transaction signature is missing for transaction at index ${index}.`
      )
    }
    const signature = bs58.encode(tx.signatures[0])
    return signature
  })

  const abortController = new AbortController()
  let bundleId: string | null = null

  // Try to simulate and send bundle with the first connection
  for (const jitoConnection of jitoConnections) {
    try {
      // Simulate bundle first
      const simulationResult =
        await jitoConnection.simulateBundle(signedTransactions)

      if (simulationResult.value.summary !== 'succeeded') {
        const summary = simulationResult.value.summary as {
          failed: { error: any; tx_signature: string }
        }

        // Extract readable error message from TransactionFailure
        const errorMsg =
          summary.failed?.error?.TransactionFailure?.[1] ||
          JSON.stringify(summary.failed?.error) ||
          'Unknown simulation error'

        throw new Error(`Bundle simulation failed: ${errorMsg}`)
      }

      // Send bundle using JitoConnection method
      bundleId = await jitoConnection.sendBundle(signedTransactions)
      break
    } catch (error) {
      // Try next connection if this one fails
      if (jitoConnection === jitoConnections[jitoConnections.length - 1]) {
        throw error
      }
    }
  }

  if (!bundleId) {
    throw new Error('Failed to send bundle to any Jito connection')
  }

  // Calculate timeout based on blockhash validity
  const blockhashResult =
    await jitoConnections[0].getLatestBlockhash('confirmed')
  const currentBlockHeight =
    await jitoConnections[0].getBlockHeight('confirmed')
  const blocksRemaining =
    blockhashResult.lastValidBlockHeight - currentBlockHeight
  // Assume ~400ms per slot, add buffer
  const timeoutMs = Math.min(blocksRemaining * 400 + 10000, 60000)

  // Confirm bundle across all Jito connections in parallel
  // Each connection polls for bundle status independently
  const confirmPromises = jitoConnections.map(async (jitoConnection) => {
    try {
      // Use the new confirmBundle method which polls for status
      const confirmed = await jitoConnection.confirmBundle(bundleId, timeoutMs)

      if (confirmed && !abortController.signal.aborted) {
        // Bundle confirmed, fetch signature statuses
        const statusResponse =
          await jitoConnection.getSignatureStatuses(txSignatures)
        abortController.abort()
        return statusResponse.value
      }

      return null
    } catch (error) {
      if (abortController.signal.aborted) {
        return null
      }
      throw error
    }
  })

  // Wait for first successful confirmation
  const signatureResults =
    (await Promise.any(confirmPromises).catch(() => null)) ??
    txSignatures.map(() => null)

  if (!abortController.signal.aborted) {
    abortController.abort()
  }

  return {
    bundleId,
    txSignatures,
    signatureResults,
  }
}
