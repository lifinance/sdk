import type {
  SendOptions,
  SignatureResult,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { sleep } from '../../utils/sleep.js'
import { getSolanaConnections } from './connection.js'

type ConfirmedTransactionResult = {
  signatureResult: SignatureResult | null
  txSignature: string
}

/**
 * Sends a Solana transaction to multiple RPC endpoints and returns the confirmation
 * as soon as any of them confirm the transaction.
 * @param signedTx - The signed transaction to send.
 * @returns - The confirmation result of the transaction.
 */
export async function sendAndConfirmTransaction(
  signedTx: VersionedTransaction
): Promise<ConfirmedTransactionResult> {
  const connections = await getSolanaConnections()

  const signedTxSerialized = signedTx.serialize()
  // Create transaction hash (signature)
  const txSignature = bs58.encode(signedTx.signatures[0])

  if (!txSignature) {
    throw new Error('Transaction signature is missing.')
  }

  const rawTransactionOptions: SendOptions = {
    // We can skip preflight check after the first transaction has been sent
    // https://solana.com/docs/advanced/retry#the-cost-of-skipping-preflight
    skipPreflight: true,
    // Setting max retries to 0 as we are handling retries manually
    maxRetries: 0,
    // https://solana.com/docs/advanced/confirmation#use-an-appropriate-preflight-commitment-level
    preflightCommitment: 'confirmed',
  }

  const abortController = new AbortController()

  const confirmPromises = connections.map(async (connection) => {
    try {
      // Send initial transaction for this connection
      try {
        await connection.sendRawTransaction(
          signedTxSerialized,
          rawTransactionOptions
        )
      } catch (_) {
        // Continue with confirmation even if initial send fails
      }

      const [blockhashResult, initialBlockHeight] = await Promise.all([
        connection.getLatestBlockhash('confirmed'),
        connection.getBlockHeight('confirmed'),
      ])
      let currentBlockHeight = initialBlockHeight
      let signatureResult: SignatureResult | null = null

      const pollingPromise = (async () => {
        while (
          currentBlockHeight < blockhashResult.lastValidBlockHeight &&
          !abortController.signal.aborted
        ) {
          const statusResponse = await connection.getSignatureStatuses([
            txSignature,
          ])

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
        }
        return null
      })()

      const sendingPromise = (async (): Promise<SignatureResult | null> => {
        while (
          currentBlockHeight < blockhashResult.lastValidBlockHeight &&
          !abortController.signal.aborted &&
          !signatureResult
        ) {
          try {
            await connection.sendRawTransaction(
              signedTxSerialized,
              rawTransactionOptions
            )
          } catch (_) {
            // Continue trying even if individual sends fail
          }

          await sleep(1000)
          if (!abortController.signal.aborted) {
            currentBlockHeight = await connection.getBlockHeight('confirmed')
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
