import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import type { SignedTransaction } from '@tronweb3/tronwallet-abstract-adapter'
import { stripHexPrefix } from '../utils/stripHexPrefix.js'
import { callTronRpcsWithRetry } from './callTronRpcsWithRetry.js'

export type TronBroadcastResult =
  | { status: 'accepted'; txHash: string }
  | { status: 'rejected'; error: unknown }
  | { status: 'unknown'; error: unknown }

/**
 * Broadcasts a signed transaction through the Tron RPCs in turn.
 *
 * - `accepted`: a node took the transaction. `DUP_TRANSACTION_ERROR` counts as
 *   accepted: the node already has it.
 * - `rejected`: every node refused it with a code, or no node was tried. The
 *   transaction cannot land.
 * - `unknown`: at least one attempt failed without a refusal code (a network
 *   error, or an answer such as an `{ Error }` body). That node may have
 *   received the transaction.
 *
 * `error` is what `callTronRpcsWithRetry` threw, unchanged.
 */
export async function broadcastTronTransaction(
  client: SDKClient,
  signedTransaction: SignedTransaction
): Promise<TronBroadcastResult> {
  let attempts = 0
  let rejections = 0
  try {
    const broadcastResult = await callTronRpcsWithRetry(
      client,
      async (tronWeb) => {
        attempts++
        const result = await tronWeb.trx.sendRawTransaction(signedTransaction)

        if (!result.result && String(result.code) !== 'DUP_TRANSACTION_ERROR') {
          // Only a refusal code is a definite rejection.
          if (result.code) {
            rejections++
          }
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            `Transaction broadcast failed: ${result.code || 'Unknown error'}`
          )
        }

        return result
      }
    )

    // DUP_TRANSACTION_ERROR responses omit the `transaction` field — fall back
    // to the txID computed locally from the signed transaction in that case.
    return {
      status: 'accepted',
      txHash: stripHexPrefix(
        broadcastResult.transaction?.txID ?? signedTransaction.txID
      ),
    }
  } catch (error) {
    return {
      status: rejections === attempts ? 'rejected' : 'unknown',
      error,
    }
  }
}
