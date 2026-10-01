import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import type { SignedTransaction } from '@tronweb3/tronwallet-abstract-adapter'
import { stripHexPrefix } from '../utils/stripHexPrefix.js'
import { callTronRpcsWithRetry } from './callTronRpcsWithRetry.js'

export type TronBroadcastResult =
  | { status: 'accepted'; txHash: string }
  | { status: 'rejected'; error: unknown }
  | { status: 'unknown'; error: unknown }

/**
 * The codes that java-tron's `Wallet.broadcastTransaction` returns before it
 * puts the transaction into the node's pending pool: a node that answers one
 * of them does not hold the transaction. Any other code proves nothing: for
 * example, java-tron returns `NOT_ENOUGH_EFFECTIVE_CONNECTION` after the push,
 * and `OTHER_ERROR` does not say at which step the broadcast failed.
 */
const PRE_PUSH_REJECTION_CODES: ReadonlySet<string> = new Set([
  'SIGERROR',
  'BLOCK_UNSOLIDIFIED',
  'NO_CONNECTION',
  'SERVER_BUSY',
  'CONTRACT_VALIDATE_ERROR',
  'CONTRACT_EXE_ERROR',
  // java-tron's spelling (api.proto `BANDWITH_ERROR = 4`). The HTTP API sends
  // the enum name. `BANDWIDTH_ERROR` is a harmless alias.
  'BANDWITH_ERROR',
  'BANDWIDTH_ERROR',
  'TAPOS_ERROR',
  'TOO_BIG_TRANSACTION_ERROR',
  'TRANSACTION_EXPIRATION_ERROR',
])

/**
 * Broadcasts a signed transaction through the Tron RPCs in turn.
 *
 * - `accepted`: a node took the transaction. `DUP_TRANSACTION_ERROR` counts as
 *   accepted: the node already has it.
 * - `rejected`: every node refused it with a code of
 *   `PRE_PUSH_REJECTION_CODES`, or no node was tried. No node holds the
 *   transaction.
 * - `unknown`: at least one attempt failed in another way: a network error, a
 *   different code (for example `NOT_ENOUGH_EFFECTIVE_CONNECTION`, which comes
 *   after the push) or an answer without a code (such as an `{ Error }` body).
 *   That node may hold the transaction.
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
          // Only a pre-push code is a definite rejection. The message is
          // never read.
          if (PRE_PUSH_REJECTION_CODES.has(String(result.code))) {
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
