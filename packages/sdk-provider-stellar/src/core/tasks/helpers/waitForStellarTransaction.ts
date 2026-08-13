import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

const CONFIRM_POLL_INTERVAL_MS = 3_000

/**
 * Outlives the backend's `[0, now + 300 s]` timebounds, so a transaction that
 * has not been applied by the deadline is genuinely dead rather than still in
 * flight. Expressed as a deadline, not an attempt count, so a caller-supplied
 * polling interval cannot shorten the budget.
 */
const CONFIRM_TIMEOUT_MS = 330_000

/**
 * Polls `getTransaction` until the transaction is included in a ledger.
 *
 * `NOT_FOUND` is not an error — Soroban RPC only knows a transaction once it has
 * been applied — so polling continues until the deadline passes and the result
 * is reported as a timeout rather than a failure.
 *
 * A transport failure costs one interval rather than the whole wait: every RPC
 * can reject one read during a rate-limit burst while the transaction is
 * perfectly healthy. The last such error rides along as the timeout's cause.
 *
 * The terminal classification is deliberately done outside
 * {@link callStellarRpcsWithRetry}; only the read goes through the failover
 * wrapper, which would otherwise wrap a classified error in an `AggregateError`.
 */
export const waitForStellarTransaction = async (
  client: SDKClient,
  transactionHash: string,
  pollingIntervalMs: number = CONFIRM_POLL_INTERVAL_MS
): Promise<rpc.Api.GetSuccessfulTransactionResponse> => {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  let lastTransportError: Error | undefined

  while (Date.now() < deadline) {
    try {
      const response = await callStellarRpcsWithRetry(client, (server) =>
        server.getTransaction(transactionHash)
      )

      if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return response
      }

      if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          `Stellar transaction ${transactionHash} failed: ${
            response.resultXdr?.result().switch().name ?? 'unknown reason'
          }`
        )
      }
    } catch (error) {
      // The ledger's verdict is terminal; only transport failures are retried.
      if (error instanceof TransactionError) {
        throw error
      }
      lastTransportError =
        error instanceof Error ? error : new Error(String(error))
    }

    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs))
  }

  throw new TransactionError(
    LiFiErrorCode.Timeout,
    `Stellar transaction ${transactionHash} was not confirmed in time.`,
    lastTransportError
  )
}
