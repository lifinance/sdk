import type { SignatureResult, VersionedTransaction } from '@solana/web3.js'
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
 * @param signedTransactions - an Array of signed transactions
 * @returns - {@link BundleResult} object containing Bundle ID, transaction signatures, and confirmation results
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

  const abortController = new AbortController()

  const confirmPromises = jitoConnections.map(async (jitoConnection) => {
    try {
      // Send initial bundle for this connection
      let bundleId: string
      try {
        bundleId = await jitoConnection.sendBundle(signedTransactions)
      } catch (_) {
        return null
      }

      const [blockhashResult, initialBlockHeight] = await Promise.all([
        jitoConnection.getLatestBlockhash('confirmed'),
        jitoConnection.getBlockHeight('confirmed'),
      ])
      let currentBlockHeight = initialBlockHeight

      while (
        currentBlockHeight < blockhashResult.lastValidBlockHeight &&
        !abortController.signal.aborted
      ) {
        const statusResponse = await jitoConnection.getBundleStatuses([
          bundleId,
        ])

        const bundleStatus = statusResponse.value[0]

        // Check if bundle is confirmed or finalized
        if (
          bundleStatus &&
          (bundleStatus.confirmation_status === 'confirmed' ||
            bundleStatus.confirmation_status === 'finalized')
        ) {
          // Bundle confirmed! Extract transaction signatures from bundle status
          const txSignatures = bundleStatus.transactions
          // Fetch individual signature results
          const sigResponse =
            await jitoConnection.getSignatureStatuses(txSignatures)

          if (!sigResponse?.value || !Array.isArray(sigResponse.value)) {
            // Keep polling, if can't find signature results.
            continue
          }

          // Immediately abort all other connections when we find a result
          abortController.abort()
          return {
            bundleId,
            txSignatures,
            signatureResults: sigResponse.value,
          }
        }

        await sleep(400)
        if (!abortController.signal.aborted) {
          currentBlockHeight = await jitoConnection.getBlockHeight('confirmed')
        }
      }

      return null
    } catch (error) {
      if (abortController.signal.aborted) {
        return null // Don't treat abortion as an error
      }
      throw error
    }
  })

  // Wait for first successful confirmation
  const result = await Promise.any(confirmPromises).catch(() => null)

  if (!abortController.signal.aborted) {
    abortController.abort()
  }

  if (!result) {
    throw new Error('Failed to send and confirm bundle')
  }

  return result
}
