import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import { rpc, type Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

const CONFIRM_POLL_ATTEMPTS = 30
const CONFIRM_POLL_INTERVAL_MS = 3_000

/**
 * Submits a signed base64 envelope over Stellar RPC.
 *
 * `DUPLICATE` is treated as success: it means this exact envelope already
 * reached the network, which is the expected outcome when
 * {@link callStellarRpcsWithRetry} fails over to a second RPC after the first
 * one accepted the submission but errored on the response. Soroban submission is
 * idempotent by transaction hash, so the correct move is to stop resubmitting and
 * start polling.
 */
export const submitStellarTransaction = async (
  client: SDKClient,
  signedTxXdr: string,
  networkPassphrase: string
): Promise<string> => {
  const transaction = TransactionBuilder.fromXDR(
    signedTxXdr,
    networkPassphrase
  ) as Transaction

  return callStellarRpcsWithRetry(client, async (server) => {
    const response = await server.sendTransaction(transaction)

    switch (response.status) {
      case 'PENDING':
      case 'DUPLICATE':
        return response.hash
      case 'TRY_AGAIN_LATER':
        throw new TransactionError(
          LiFiErrorCode.RateLimitExceeded,
          'Stellar RPC asked to try again later.'
        )
      default:
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          `Stellar transaction submission failed: ${
            response.errorResult?.result().switch().name ?? response.status
          }`
        )
    }
  })
}

/**
 * Polls `getTransaction` until the transaction is included in a ledger.
 *
 * A `NOT_FOUND` result is not yet an error — Soroban RPC only sees a transaction
 * once it has been applied — so it keeps polling until the attempt budget runs
 * out, then reports a timeout rather than a failure.
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
