import { type SDKClient, sleep } from '@lifi/sdk'
import {
  type Commitment,
  getBase64EncodedWireTransaction,
  type Signature,
  type Transaction,
  type TransactionError,
} from '@solana/kit'

import {
  getJitoConnections,
  getSolanaConnections,
} from '../client/connection.js'

type SignatureStatus = {
  slot: bigint
  confirmations: bigint | null
  err: TransactionError | null
  confirmationStatus: Commitment | null
  status: Readonly<{ Err: TransactionError }> | Readonly<{ Ok: null }>
}

export type BundleResult = {
  bundleId: string
  txSignatures: Signature[]
  signatureResults: (SignatureStatus | null)[]
}

/**
 * Send and confirm a bundle of transactions using Jito.
 * Automatically selects a Jito-enabled RPC connection and polls for confirmation
 * across multiple Jito RPCs in parallel.
 * @param client - The SDK client.
 * @param signedTransactions - Array of signed transactions to bundle.
 * @returns BundleResult containing Bundle ID, transaction signatures, and confirmation results.
 */
export async function sendAndConfirmBundle(
  client: SDKClient,
  signedTransactions: Transaction[]
): Promise<BundleResult> {
  const [jitoConnections, solanaConnections] = await Promise.all([
    getJitoConnections(client),
    getSolanaConnections(client),
  ])

  if (jitoConnections.length === 0) {
    throw new Error(
      'No Jito-enabled RPC connection available for bundle submission'
    )
  }

  if (solanaConnections.length === 0) {
    throw new Error('No Solana RPC connection available')
  }

  // Serialize transactions to base64
  const serializedTransactions = signedTransactions.map((tx) =>
    getBase64EncodedWireTransaction(tx)
  )

  // Use first Solana connection for blockhash/blockheight queries
  const solanaRpc = solanaConnections[0]

  const abortController = new AbortController()

  const confirmPromises = jitoConnections.map(async (jitoConnection) => {
    try {
      // Send bundle to Jito
      let bundleId: string
      try {
        bundleId = await jitoConnection
          .sendBundle(serializedTransactions)
          .send()
      } catch (_) {
        return null
      }

      const [{ value: blockhashResult }, initialBlockHeight] =
        await Promise.all([
          solanaRpc
            .getLatestBlockhash({
              commitment: 'confirmed',
            })
            .send(),
          solanaRpc
            .getBlockHeight({
              commitment: 'confirmed',
            })
            .send(),
        ])

      let currentBlockHeight = initialBlockHeight

      while (
        currentBlockHeight < blockhashResult.lastValidBlockHeight &&
        !abortController.signal.aborted
      ) {
        const statusResponse = await jitoConnection
          .getBundleStatuses([bundleId])
          .send()

        const bundleStatus = statusResponse.value[0]

        // Check if bundle is confirmed or finalized
        if (
          bundleStatus &&
          (bundleStatus.confirmation_status === 'confirmed' ||
            bundleStatus.confirmation_status === 'finalized')
        ) {
          // Bundle confirmed! Extract transaction signatures from bundle status
          const txSignatures = bundleStatus.transactions

          // Fetch individual signature results from Solana RPC
          const sigResponse = await solanaRpc
            .getSignatureStatuses(txSignatures)
            .send()

          if (!sigResponse?.value || !Array.isArray(sigResponse.value)) {
            // Keep polling if can't find signature results
            await sleep(400)
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
          currentBlockHeight = await solanaRpc
            .getBlockHeight({
              commitment: 'confirmed',
            })
            .send()
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
