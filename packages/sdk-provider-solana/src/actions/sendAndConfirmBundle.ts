import { type SDKClient, sleep } from '@lifi/sdk'
import {
  type Commitment,
  getBase64EncodedWireTransaction,
  type Signature,
  type Transaction,
  type TransactionError,
} from '@solana/kit'

import { getJitoConnections } from '../client/connection.js'

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
  const jitoConnections = await getJitoConnections(client)

  if (jitoConnections.length === 0) {
    throw new Error(
      'No Jito-enabled RPC connection available for bundle submission'
    )
  }

  // Serialize transactions to base64
  const serializedTransactions = signedTransactions.map((tx) =>
    getBase64EncodedWireTransaction(tx)
  )

  const abortController = new AbortController()

  const confirmPromises = jitoConnections.map(async (jitoRpc) => {
    try {
      // Send bundle to Jito
      let bundleId: string
      try {
        bundleId = await jitoRpc.sendBundle(serializedTransactions).send()
      } catch (_) {
        return null
      }

      const [{ value: blockhashResult }, initialBlockHeight] =
        await Promise.all([
          jitoRpc
            .getLatestBlockhash({
              commitment: 'confirmed',
            })
            .send(),
          jitoRpc
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
        const statusResponse = await jitoRpc
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

          // Fetch individual signature results from Jito RPC
          const sigResponse = await jitoRpc
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
          currentBlockHeight = await jitoRpc
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
