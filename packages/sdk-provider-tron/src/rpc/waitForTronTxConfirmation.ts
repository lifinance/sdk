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

// `receipt.result` is the protocol's `contractResult` enum. SUCCESS marks a
// successful contract call; DEFAULT (enum 0) is omitted from the JSON in
// practice and never marks a failure. Every other value (REVERT, OUT_OF_ENERGY,
// OUT_OF_TIME, …) is an execution failure. The enum has no FAILED member.
const NON_FAILURE_CONTRACT_RESULTS = new Set(['SUCCESS', 'DEFAULT'])

function createOnChainFailureError(
  message: string,
  reason?: string
): TransactionError {
  if (reason === 'OUT_OF_ENERGY') {
    return new TransactionError(
      LiFiErrorCode.InsufficientFunds,
      `${message}: OUT_OF_ENERGY. Insufficient TRX for energy. The account needs more TRX to cover transaction fees.`
    )
  }
  return new TransactionError(
    LiFiErrorCode.TransactionFailed,
    reason ? `${message}: ${reason}.` : `${message}.`
  )
}

/**
 * Polls getTransactionInfo until the transaction is indexed, then resolves.
 *
 * Tron reports a failed execution with a top-level `result: 'FAILED'` (the
 * field is omitted on success) and puts the reason in `receipt.result`. Both
 * are checked so a node that drops the top-level field cannot turn a reverted
 * transaction into a confirmation.
 *
 * Throws `TransactionError` immediately (no retry) on an on-chain failure:
 * `InsufficientFunds` for OUT_OF_ENERGY, `TransactionFailed` otherwise.
 * Tolerates up to `TRON_POLL_MAX_ERROR_RETRIES` transient RPC errors. Caps
 * total polls at `TRON_POLL_MAX_POLLS` to prevent hanging on stuck indexing —
 * note that `waitForResult`'s own maxRetries counts errors only, so an explicit
 * poll budget is enforced here.
 *
 * `onChainFailureMessage` is a sentence stem without a trailing period; the
 * failure reason is appended as `: REASON.`
 */
export async function waitForTronTxConfirmation(
  client: SDKClient,
  txHash: string,
  onChainFailureMessage = 'Transaction failed on-chain'
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
      if (!txInfo?.id) {
        return undefined
      }
      const contractResult = txInfo.receipt?.result
      const isContractFailure =
        !!contractResult && !NON_FAILURE_CONTRACT_RESULTS.has(contractResult)
      if (txInfo.result === 'FAILED' || isContractFailure) {
        throw createOnChainFailureError(
          onChainFailureMessage,
          isContractFailure ? contractResult : undefined
        )
      }
      return txInfo
    },
    TRON_POLL_INTERVAL_MS,
    TRON_POLL_MAX_ERROR_RETRIES,
    (_count, error) => !(error instanceof TransactionError)
  )
}
