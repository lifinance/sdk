import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import {
  type rpc,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { callStellarRpcsWithRetry } from '../../../client/getStellarRpc.js'

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

  const response: rpc.Api.SendTransactionResponse =
    await callStellarRpcsWithRetry(client, (server) =>
      server.sendTransaction(transaction)
    )

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
}
