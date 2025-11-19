import {
  type Commitment,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Transaction,
  type TransactionError,
} from '@solana/kit'
import type { SDKClient } from '../../types/core.js'
import { sleep } from '../../utils/sleep.js'
import { getSolanaConnections } from './connection.js'

type SignatureStatus = {
  slot: bigint
  confirmations: bigint | null
  err: TransactionError | null
  confirmationStatus: Commitment | null
  status: Readonly<{ Err: TransactionError }> | Readonly<{ Ok: null }>
}

type ConfirmedTransactionResult = {
  signatureResult: SignatureStatus | null
  txSignature: string
}

/**
 * Sends a Solana transaction to multiple RPC endpoints and returns the confirmation
 * as soon as any of them confirm the transaction.
 * @param client - The SDK client.
 * @param signedTx - The signed transaction to send.
 * @returns - The confirmation result of the transaction.
 */
export async function sendAndConfirmTransaction(
  client: SDKClient,
  signedTx: Transaction
): Promise<ConfirmedTransactionResult> {
  const connections = await getSolanaConnections(client)

  const signedTxSerialized = getBase64EncodedWireTransaction(signedTx)
  // Create transaction hash (signature)
  const txSignature = getSignatureFromTransaction(signedTx)

  if (!txSignature) {
    throw new Error('Transaction signature is missing.')
  }

  const rawTransactionOptions = {
    // We can skip preflight check after the first transaction has been sent
    // https://solana.com/docs/advanced/retry#the-cost-of-skipping-preflight
    skipPreflight: true,
    // Setting max retries to 0 as we are handling retries manually
    maxRetries: BigInt(0),
    // https://solana.com/docs/advanced/confirmation#use-an-appropriate-preflight-commitment-level
    preflightCommitment: 'confirmed' as Commitment,
    encoding: 'base64' as const,
  }

  const abortController = new AbortController()

  const confirmPromises = connections.map(async (connection) => {
    try {
      // Send initial transaction for this connection
      try {
        await connection
          .sendTransaction(signedTxSerialized, rawTransactionOptions)
          .send()
      } catch (_) {
        // Continue with confirmation even if initial send fails
      }

      const [{ value: blockhashResult }, initialBlockHeight] =
        await Promise.all([
          connection
            .getLatestBlockhash({
              commitment: 'confirmed',
            })
            .send(),
          connection
            .getBlockHeight({
              commitment: 'confirmed',
            })
            .send(),
        ])

      let signatureResult: SignatureStatus | null = null

      const pollingPromise = (async () => {
        let blockHeight = initialBlockHeight
        while (
          blockHeight < blockhashResult.lastValidBlockHeight &&
          !abortController.signal.aborted
        ) {
          const statusResponse = await connection
            .getSignatureStatuses([txSignature])
            .send()

          const status = statusResponse.value[0]
          if (
            status &&
            (status.confirmationStatus === 'confirmed' ||
              status.confirmationStatus === 'finalized')
          ) {
            signatureResult = status
            // Immediately abort all other connections when we find a result
            abortController.abort()
            return status
          }

          await sleep(400)

          if (!abortController.signal.aborted) {
            blockHeight = await connection
              .getBlockHeight({
                commitment: 'confirmed',
              })
              .send()
          }
        }
        return null
      })()

      const sendingPromise = (async (): Promise<SignatureStatus | null> => {
        let blockHeight = initialBlockHeight
        while (
          blockHeight < blockhashResult.lastValidBlockHeight &&
          !abortController.signal.aborted &&
          !signatureResult
        ) {
          try {
            await connection
              .sendTransaction(signedTxSerialized, rawTransactionOptions)
              .send()
          } catch (_) {
            // Continue trying even if individual sends fail
          }

          await sleep(1000)
          if (!abortController.signal.aborted) {
            blockHeight = await connection
              .getBlockHeight({
                commitment: 'confirmed',
              })
              .send()
          }
        }
        return null
      })()

      // Wait for polling to find the result
      const result = await Promise.race([pollingPromise, sendingPromise])
      return result
    } catch (error) {
      if (abortController.signal.aborted) {
        return null // Don't treat abortion as an error
      }
      throw error
    }
  })

  const signatureResult = await Promise.any(confirmPromises).catch(() => null)

  if (!abortController.signal.aborted) {
    abortController.abort()
  }

  return { signatureResult, txSignature }
}
