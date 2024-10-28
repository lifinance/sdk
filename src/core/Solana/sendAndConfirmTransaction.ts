import type {
  SendOptions,
  SignatureResult,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { sleep } from '../../utils/sleep.js'
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

  for (const connection of connections) {
    connection
      .sendRawTransaction(signedTxSerialized, rawTransactionOptions)
      .catch()
  }

  const abortControllers: AbortController[] = []

  const confirmPromises = connections.map(async (connection) => {
    const abortController = new AbortController()
    abortControllers.push(abortController)
    try {
      const blockhashResult = await connection.getLatestBlockhash('confirmed')

      const confirmTransactionPromise = connection
        .confirmTransaction(
          {
            signature: txSignature,
            blockhash: blockhashResult.blockhash,
            lastValidBlockHeight: blockhashResult.lastValidBlockHeight,
            abortSignal: abortController.signal,
          },
          'confirmed'
        )
        .then((result) => result.value)

      let signatureResult: SignatureResult | null = null
      let blockHeight = await connection.getBlockHeight('confirmed')

      while (
        !signatureResult &&
        blockHeight < blockhashResult.lastValidBlockHeight
      ) {
        await connection.sendRawTransaction(
          signedTxSerialized,
          rawTransactionOptions
        )
        signatureResult = await Promise.race([
          confirmTransactionPromise,
          sleep(1000),
        ])

        if (signatureResult || abortController.signal.aborted) {
          break
        }

        blockHeight = await connection.getBlockHeight('confirmed')
      }

      abortController.abort()

      return signatureResult
    } catch (error) {
      if (abortController.signal.aborted) {
        return Promise.reject(new Error('Confirmation aborted.'))
      }
      throw error
    }
  })

  const signatureResult = await Promise.any(confirmPromises).catch(() => null)

  for (const abortController of abortControllers) {
    abortController.abort()
  }

  return { signatureResult, txSignature }
}
