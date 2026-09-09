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

// `receipt.result` carries the `Transaction.Result.contractResult` enum from
// java-tron's Tron.proto (not to be confused with the sibling `contractResult`
// array on TransactionInfo, which holds the call's return data):
// https://github.com/tronprotocol/java-tron/blob/develop/protocol/src/main/protos/core/Tron.proto
// SUCCESS marks a successful contract call. DEFAULT is enum 0 — omitted from
// the JSON in practice, and never a failure. Every other member (REVERT,
// OUT_OF_ENERGY, OUT_OF_TIME, …) is an execution failure; the enum has no
// FAILED member. Unknown values are treated as failures so the helper can
// never report a reverted transaction as confirmed.
const NON_FAILURE_CONTRACT_RESULTS = new Set(['SUCCESS', 'DEFAULT'])

function createOnChainFailureError(
  messageStem: string,
  reason?: string
): TransactionError {
  // Callers pass a sentence stem; tolerate a trailing period so the reason
  // never renders as "… on-chain.: REVERT."
  const stem = messageStem.replace(/\.$/, '')
  if (reason === 'OUT_OF_ENERGY') {
    // OUT_OF_ENERGY also occurs when the feeLimit is too low for a funded
    // account, so the message suggests the balance without asserting it.
    return new TransactionError(
      LiFiErrorCode.InsufficientFunds,
      `${stem}: ${reason}. The account may need more TRX to cover the energy fee.`
    )
  }
  return new TransactionError(
    LiFiErrorCode.TransactionFailed,
    reason ? `${stem}: ${reason}.` : `${stem}.`
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
 * `onChainFailureMessage` is a sentence stem; the failure reason is appended
 * as `: REASON.` A trailing period on the stem is tolerated.
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
