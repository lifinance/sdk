import { type SDKClient, sleep } from '@lifi/sdk'
import {
  type Blockhash,
  type Commitment,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  type Signature,
  type Transaction,
  type TransactionError,
} from '@solana/kit'

import { getJitoRpcs } from '../rpc/registry.js'

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

function extractBlockhash(signedTransaction: Transaction): Blockhash {
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    signedTransaction.messageBytes
  )
  return compiledMessage.lifetimeToken as Blockhash
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

      while (blockhashValid && !abortController.signal.aborted) {
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
          const { value: isValid } = await jitoRpc
            .isBlockhashValid(txBlockhash, {
              commitment: 'confirmed',
            })
            .send()
          blockhashValid = isValid
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
