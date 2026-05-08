import { type SDKClient, sleep } from '@lifi/sdk'
import {
  type Commitment,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Transaction,
  type TransactionError,
} from '@solana/kit'
import { getSolanaRpcs } from '../rpc/registry.js'
import { extractBlockhash } from '../utils/extractBlockhash.js'

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

function getConfirmedStatus(
  statusResponse: Readonly<{
    value: readonly (SignatureStatus | null)[]
  }>
): SignatureStatus | null {
  const status = statusResponse.value[0]
  if (
    status &&
    (status.confirmationStatus === 'confirmed' ||
      status.confirmationStatus === 'finalized')
  ) {
    return status
  }
  return null
}

/**
 * Sends a Solana transaction to multiple RPC endpoints and returns the confirmation
 * as soon as any of them confirm the transaction.
 * @param client - The SDK client.
 * @param signedTransaction - The signed transaction to send.
 * @returns - The confirmation result of the transaction.
 */
export async function sendAndConfirmTransaction(
  client: SDKClient,
  signedTransaction: Transaction
): Promise<ConfirmedTransactionResult> {
  const solanaRpcs = await getSolanaRpcs(client)

  const signedTxSerialized = getBase64EncodedWireTransaction(signedTransaction)
  const txSignature = getSignatureFromTransaction(signedTransaction)

  if (!txSignature) {
    throw new Error('Transaction signature is missing.')
  }

  const txBlockhash = extractBlockhash(signedTransaction)

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

  const confirmPromises = solanaRpcs.map(async (rpc) => {
    try {
      // Send initial transaction for this RPC
      try {
        await rpc
          .sendTransaction(signedTxSerialized, rawTransactionOptions)
          .send()
      } catch (_) {
        // Continue with confirmation even if initial send fails
      }

      let signatureResult: SignatureStatus | null = null
      let blockhashValid = true

      const pollingPromise = (async () => {
        while (blockhashValid && !abortController.signal.aborted) {
          const confirmed = getConfirmedStatus(
            await rpc.getSignatureStatuses([txSignature]).send()
          )
          if (confirmed) {
            signatureResult = confirmed
            abortController.abort()
            return confirmed
          }

          await sleep(400)
        }

        // Final status check — the tx may have confirmed between the last
        // poll and the blockhash expiring.
        if (!abortController.signal.aborted) {
          const confirmed = getConfirmedStatus(
            await rpc.getSignatureStatuses([txSignature]).send()
          )
          if (confirmed) {
            signatureResult = confirmed
            abortController.abort()
            return confirmed
          }
        }

        return null
      })()

      // Sending loop runs in the background — only pollingPromise produces results.
      const sendingPromise = (async () => {
        while (
          blockhashValid &&
          !abortController.signal.aborted &&
          !signatureResult
        ) {
          try {
            await rpc
              .sendTransaction(signedTxSerialized, rawTransactionOptions)
              .send()
          } catch (_) {
            // Continue trying even if individual sends fail
          }

          await sleep(1000)
          if (!abortController.signal.aborted) {
            const { value: isValid } = await rpc
              .isBlockhashValid(txBlockhash, {
                commitment: 'confirmed',
              })
              .send()
            blockhashValid = isValid
          }
        }
      })()
      sendingPromise.catch(() => {})

      const result = await pollingPromise
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
