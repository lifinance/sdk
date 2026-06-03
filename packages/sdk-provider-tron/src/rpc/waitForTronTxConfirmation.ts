import {
  LiFiErrorCode,
  type SDKClient,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import {
  TRON_POLL_INTERVAL_MS,
  TRON_POLL_MAX_ERROR_RETRIES,
  TRON_POLL_MAX_POLLS,
} from '../core/constants.js'
import { callTronRpcsWithRetry } from './callTronRpcsWithRetry.js'

/**
 * Polls getTransactionInfo until the transaction is indexed, then resolves.
 *
 * Throws `TransactionError(TransactionFailed)` immediately (no retry) when the
 * receipt indicates on-chain failure. Tolerates up to
 * `TRON_POLL_MAX_ERROR_RETRIES` transient RPC errors. Caps total polls at
 * `TRON_POLL_MAX_POLLS` to prevent hanging on stuck indexing — note that
 * `waitForResult`'s own maxRetries counts errors only, so an explicit poll
 * budget is enforced here.
 */
export async function waitForTronTxConfirmation(
  client: SDKClient,
  txHash: string,
  onChainFailureMessage = 'Transaction failed on-chain.'
): Promise<void> {
  let polls = 0
  await waitForResult(
    async () => {
      if (++polls > TRON_POLL_MAX_POLLS) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          'Transaction confirmation timeout.'
        )
      }
      const txInfo = await callTronRpcsWithRetry(client, (tronWeb) =>
        tronWeb.trx.getTransactionInfo(txHash)
      )
      if (txInfo?.id) {
        if (txInfo.receipt?.result === 'FAILED') {
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            onChainFailureMessage
          )
        }
        return txInfo
      }
      return undefined
    },
    TRON_POLL_INTERVAL_MS,
    TRON_POLL_MAX_ERROR_RETRIES,
    (_count, error) => !(error instanceof TransactionError)
  )
}
