import { type SDKClient, sleep } from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  type Signature,
  type Transaction,
} from '@solana/kit'

import { getJitoRpcs } from '../rpc/registry.js'
import { extractBlockhash } from '../utils/extractBlockhash.js'
import {
  isConfirmedCommitment,
  type SignatureStatus,
} from '../utils/getConfirmedStatus.js'

export type BundleResult = {
  bundleId: string
  txSignatures: Signature[]
  signatureResults: (SignatureStatus | null)[]
}

const NULL_BUNDLE_RESULT = new Error(
  'Bundle was not confirmed by this RPC'
)

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
  const jitoRpcs = await getJitoRpcs(client)

  if (jitoRpcs.length === 0) {
    throw new Error(
      'No Jito-enabled RPC connection available for bundle submission'
    )
  }

  // Serialize transactions to base64
  const serializedTransactions = signedTransactions.map((tx) =>
    getBase64EncodedWireTransaction(tx)
  )

  const txBlockhash = extractBlockhash(signedTransactions[0])

  const abortController = new AbortController()

  const confirmPromises = jitoRpcs.map(async (jitoRpc) => {
    try {
      // Send bundle to Jito
      let bundleId: string
      try {
        bundleId = await jitoRpc.sendBundle(serializedTransactions).send()
      } catch (_) {
        return null
      }

      let blockhashValid = true

      // For durable nonce txs, fall back to block-height-based timeout
      let expiryBlockHeight: bigint | undefined
      if (!txBlockhash) {
        const { value: blockhashResult } = await jitoRpc
          .getLatestBlockhash({ commitment: 'confirmed' })
          .send()
        expiryBlockHeight = blockhashResult.lastValidBlockHeight
      }

      while (blockhashValid && !abortController.signal.aborted) {
        const statusResponse = await jitoRpc
          .getBundleStatuses([bundleId])
          .send()

        const bundleStatus = statusResponse.value[0]

        if (
          bundleStatus &&
          isConfirmedCommitment(bundleStatus.confirmation_status)
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
          try {
            if (txBlockhash) {
              const { value: isValid } = await jitoRpc
                .isBlockhashValid(txBlockhash, {
                  commitment: 'confirmed',
                })
                .send()
              blockhashValid = isValid
            } else {
              const blockHeight = await jitoRpc
                .getBlockHeight({ commitment: 'confirmed' })
                .send()
              blockhashValid = blockHeight < expiryBlockHeight!
            }
          } catch (_) {
            // If the validity check fails, keep polling — the blockhash
            // may still be valid and other RPCs can confirm independently.
          }
        }
      }

      // Final status check — the bundle may have confirmed between the
      // last poll and the blockhash expiring.
      if (!abortController.signal.aborted) {
        const statusResponse = await jitoRpc
          .getBundleStatuses([bundleId])
          .send()

        const bundleStatus = statusResponse.value[0]
        if (
          bundleStatus &&
          isConfirmedCommitment(bundleStatus.confirmation_status)
        ) {
          const txSignatures = bundleStatus.transactions
          const sigResponse = await jitoRpc
            .getSignatureStatuses(txSignatures)
            .send()

          if (sigResponse?.value && Array.isArray(sigResponse.value)) {
            abortController.abort()
            return {
              bundleId,
              txSignatures,
              signatureResults: sigResponse.value,
            }
          }
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
  const result = await Promise.any(
    confirmPromises.map(async (promise) => {
      const bundleResult = await promise
      if (!bundleResult) {
        throw NULL_BUNDLE_RESULT
      }
      return bundleResult
    })
  ).catch(() => null)

  if (!abortController.signal.aborted) {
    abortController.abort()
  }

  if (!result) {
    throw new Error('Failed to send and confirm bundle')
  }

  return result
}
