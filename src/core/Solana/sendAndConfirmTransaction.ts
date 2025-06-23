import type {
  Connection,
  SendOptions,
  SignatureResult,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { getSolanaConnections } from './connection.js'

export type ConfirmedTransactionResult = {
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
  // Create transaction hash (signature) from the signed transaction
  const originalSignature = bs58.encode(signedTx.signatures[0])

  if (!originalSignature) {
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

  const pollPromises = connections.map(async (connection) => {
    const timeout = 60000
    const startTime = Date.now()
    let sentSignature: string | null = null

    // Retry sending until timeout or success
    while (Date.now() - startTime < timeout) {
      try {
        sentSignature = await connection.sendRawTransaction(
          signedTxSerialized,
          rawTransactionOptions
        )

        // Immediately start polling for confirmation after successful send
        const confirmedSignature = await pollTransactionConfirmation(
          sentSignature,
          connection
        )
        return {
          signatureResult: { err: null },
          txSignature: confirmedSignature,
        }
      } catch (error) {
        // Log error for debugging but continue retrying
        console.warn('Failed to send transaction to connection:', error)
      }
    }

    throw new Error('Failed to send transaction after timeout')
  })

  try {
    const result = await Promise.any(pollPromises)
    return result
  } catch (error) {
    // All connections failed - throw error instead of returning unconfirmed signature
    throw new Error(
      `Failed to send and confirm transaction on any connection: ${error}`
    )
  }
}

async function pollTransactionConfirmation(
  txtSig: TransactionSignature,
  connection: Connection
): Promise<TransactionSignature> {
  // 15 second timeout
  const timeout = 15000
  // 5 second retry interval
  const interval = 5000
  let elapsed = 0

  return new Promise<TransactionSignature>((resolve, reject) => {
    const intervalId = setInterval(async () => {
      elapsed += interval

      if (elapsed >= timeout) {
        clearInterval(intervalId)
        reject(new Error(`Transaction ${txtSig}'s confirmation timed out`))
      }

      const status = await connection.getSignatureStatuses([txtSig])

      if (status?.value[0]?.confirmationStatus === 'confirmed') {
        clearInterval(intervalId)
        resolve(txtSig)
      }
    }, interval)
  })
}
