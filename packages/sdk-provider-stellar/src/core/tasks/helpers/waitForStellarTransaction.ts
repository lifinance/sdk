import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

const CONFIRM_POLL_ATTEMPTS = 30
const CONFIRM_POLL_INTERVAL_MS = 3_000

/**
 * Polls `getTransaction` until the transaction is included in a ledger.
 *
 * `NOT_FOUND` is not an error — Soroban RPC only knows a transaction once it has
 * been applied — so polling continues until the attempt budget runs out and the
 * result is reported as a timeout rather than a failure.
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
  for (let attempt = 0; attempt < CONFIRM_POLL_ATTEMPTS; attempt++) {
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

    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs))
  }

  throw new TransactionError(
    LiFiErrorCode.Timeout,
    `Stellar transaction ${transactionHash} was not confirmed in time.`
  )
}
