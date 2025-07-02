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
    const blockhashResult = await connection.getLatestBlockhash('confirmed')
    let blockHeight = await connection.getBlockHeight('confirmed')
    let isConfirmed = false

    while (
      !isConfirmed &&
      blockHeight <= blockhashResult.lastValidBlockHeight
    ) {
      const sentSignature = await connection.sendRawTransaction(
        signedTxSerialized,
        rawTransactionOptions
      )

      isConfirmed = await pollTransactionConfirmation(sentSignature, connection)

      if (isConfirmed) {
        break
      }

      blockHeight = await connection.getBlockHeight('confirmed')
    }

    if (!isConfirmed) {
      throw new Error('Transaction confirmation failed')
    }

    return {
      signatureResult: { err: null },
      txSignature,
    }
  })

  return await Promise.any(pollPromises).catch((err) => ({
    signatureResult: { err },
    txSignature,
  }))
}

async function pollTransactionConfirmation(
  txtSig: TransactionSignature,
  connection: Connection
): Promise<boolean> {
  // 1s timeout
  const timeout = 1000
  // .4s polling interval
  const interval = 400
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
    return true
  }

  return new Promise<boolean>((resolve, reject) => {
    const intervalId = setInterval(async () => {
      try {
        const elapsed = Date.now() - startTime
        if (elapsed >= timeout) {
          clearInterval(intervalId)
          reject(new Error(`Transaction ${txtSig}'s confirmation timed out`))
          return
        }

        const isConfirmed = await checkStatus()

        if (isConfirmed) {
          clearInterval(intervalId)
          resolve(true)
        }
      } catch (e) {
        clearInterval(intervalId)
        reject(e)
      }
    }, interval)
  })
}
