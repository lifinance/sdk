import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import { type Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import type { Api } from '@stellar/stellar-sdk/rpc'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

/**
 * `TRY_AGAIN_LATER` says the envelope is valid but was not queued, so the fix
 * is to send the same envelope again. Submission is idempotent by hash, which
 * makes the retry free of side effects.
 */
const TRY_AGAIN_ATTEMPTS = 3
const TRY_AGAIN_DELAY_MS = 2_000

/**
 * Submits a signed base64 envelope over Stellar RPC and returns the hash.
 *
 * Only the transport call goes through {@link callStellarRpcsWithRetry}, so a
 * dead RPC fails over to the next one. Classifying the response happens outside
 * that wrapper on purpose: the helper collapses everything its callback throws
 * into an `AggregateError`, which would hide a classified `TransactionError`
 * from `parseStellarErrors` and surface every rejection as an unknown error.
 *
 * `DUPLICATE` counts as success — it means this exact envelope already reached
 * the network, the expected outcome when failover retries a submission the first
 * RPC had in fact accepted. Soroban submission is idempotent by hash, so the
 * right move is to stop resubmitting and start polling.
 *
 * `TRY_AGAIN_LATER` is retried a bounded number of times rather than thrown:
 * core is telling us the envelope was not queued, not that it is invalid.
 */
export const submitStellarTransaction = async (
  client: SDKClient,
  signedTxXdr: string,
  networkPassphrase: string
): Promise<string> => {
  const transaction = TransactionBuilder.fromXdr(
    signedTxXdr,
    networkPassphrase
  ) as Transaction

  for (let attempt = 0; attempt < TRY_AGAIN_ATTEMPTS; attempt++) {
    const response: Api.SendTransactionResponse =
      await callStellarRpcsWithRetry(client, (server) =>
        server.sendTransaction(transaction)
      )

    switch (response.status) {
      case 'PENDING':
      case 'DUPLICATE':
        return response.hash
      case 'TRY_AGAIN_LATER':
        break
      default:
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          `Stellar transaction submission failed: ${
            response.errorResult?.result.type ?? response.status
          }`
        )
    }

    if (attempt < TRY_AGAIN_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, TRY_AGAIN_DELAY_MS))
    }
  }

  throw new TransactionError(
    LiFiErrorCode.RateLimitExceeded,
    'Stellar RPC asked to try again later.'
  )
}
