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

  const pollPromises = connections.map(async (connection) => {
    let sentSignature: string | null = null

    let blockhashResult = await connection.getLatestBlockhash('confirmed')
    let currentBlockHeight = await connection.getBlockHeight('confirmed')
    let confirmedSignature = null

    while (
      !confirmedSignature &&
      currentBlockHeight < blockhashResult.lastValidBlockHeight
    ) {
      sentSignature = await connection.sendRawTransaction(
        signedTxSerialized,
        rawTransactionOptions
      )

      confirmedSignature = await pollTransactionConfirmation(
        sentSignature,
        connection
      )

      blockhashResult = await connection.getLatestBlockhash('confirmed')
      currentBlockHeight = await connection.getBlockHeight('confirmed')
    }

    if (!confirmedSignature) {
      throw new Error('Transaction confirmation failed')
    }

    return {
      signatureResult: { err: null },
      txSignature: confirmedSignature,
    }
  })

  try {
    const result = await Promise.any(pollPromises)
    return result
  } catch (error) {
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
  // 1 second retry interval
  const interval = 1000
  const startTime = Date.now()

  const checkStatus = async () => {
    try {
      const status = await connection.getSignatureStatuses([txtSig])
      return status?.value[0]?.confirmationStatus === 'confirmed'
    } catch (_) {
      return false
    }
  }

  // Initial check
  const isConfirmed = await checkStatus()
  if (isConfirmed) {
    return txtSig
  }

  return new Promise<TransactionSignature>((resolve, reject) => {
    const intervalId = setInterval(async () => {
      const elapsed = Date.now() - startTime

      if (elapsed >= timeout) {
        clearInterval(intervalId)
        reject(new Error(`Transaction ${txtSig}'s confirmation timed out`))
        return
      }

      const isConfirmed = await checkStatus()

      if (isConfirmed) {
        clearInterval(intervalId)
        resolve(txtSig)
      }
    }, interval)
  })
}
