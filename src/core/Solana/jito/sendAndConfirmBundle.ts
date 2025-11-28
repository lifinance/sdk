import type { SignatureResult, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { sleep } from '../../../utils/sleep.js'
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

  // Now confirm the bundle across all Jito connections in parallel
  const confirmPromises = jitoConnections.map(async (jitoConnection) => {
    try {
      // Get initial blockhash and block height
      const [blockhashResult, initialBlockHeight] = await Promise.all([
        jitoConnection.getLatestBlockhash('confirmed'),
        jitoConnection.getBlockHeight('confirmed'),
      ])
      let signatureResults: (SignatureResult | null)[] = txSignatures.map(
        () => null
      )

      const pollingPromise = (async () => {
        let pollingBlockHeight = initialBlockHeight
        while (
          pollingBlockHeight < blockhashResult.lastValidBlockHeight &&
          !abortController.signal.aborted
        ) {
          const statusResponse =
            await jitoConnection.getSignatureStatuses(txSignatures)

          const allConfirmed = statusResponse.value.every(
            (status) =>
              status &&
              (status.confirmationStatus === 'confirmed' ||
                status.confirmationStatus === 'finalized')
          )

          if (allConfirmed) {
            signatureResults = statusResponse.value
            // Immediately abort all other connections when we find results
            abortController.abort()
            return signatureResults
          }

          await sleep(400)
          // Update block height independently to avoid stale reads
          if (!abortController.signal.aborted) {
            pollingBlockHeight =
              await jitoConnection.getBlockHeight('confirmed')
          }
        }
        return null
      })()

      const sendingPromise = (async (): Promise<
        (SignatureResult | null)[] | null
      > => {
        let sendingBlockHeight = initialBlockHeight
        while (
          sendingBlockHeight < blockhashResult.lastValidBlockHeight &&
          !abortController.signal.aborted &&
          signatureResults.every((r) => r === null)
        ) {
          try {
            // Re-send bundle periodically
            await jitoConnection.sendBundle(signedTransactions)
          } catch (_) {
            // Silently retry on send failures - polling will detect success
          }

          await sleep(1000)
          if (!abortController.signal.aborted) {
            sendingBlockHeight =
              await jitoConnection.getBlockHeight('confirmed')
          }
        }
        return null
      })()

      // Wait for polling to find the results
      const result = await Promise.race([pollingPromise, sendingPromise])
      return result
    } catch (error) {
      if (abortController.signal.aborted) {
        return null // Don't treat abortion as an error
      }
      throw error
    }
  })

  // Wait for the first connection to return (either success or timeout)
  // If a connection finds confirmation, it aborts all others via abortController
  // If all connections reject (throw errors), catch and return null array
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
