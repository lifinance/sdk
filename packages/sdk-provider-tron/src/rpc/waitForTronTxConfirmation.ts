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

// `receipt.result` is java-tron's `Transaction.Result.contractResult` enum. It has
// no FAILED member: SUCCESS and DEFAULT (enum 0) mean success, anything else is
// an execution failure (REVERT, OUT_OF_ENERGY, OUT_OF_TIME, …).
const NON_FAILURE_CONTRACT_RESULTS = new Set(['SUCCESS', 'DEFAULT'])

function createOnChainFailureError(
  messageStem: string,
  reason?: string
): TransactionError {
  const stem = messageStem.replace(/\.$/, '')
  if (reason === 'OUT_OF_ENERGY') {
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
 * Tron marks a failed execution with a top-level `result: 'FAILED'` (omitted on
 * success) and puts the reason in `receipt.result`; both are checked. Throws
 * `TransactionError` without retry on failure (`InsufficientFunds` for
 * OUT_OF_ENERGY, `TransactionFailed` otherwise). Tolerates up to
 * `TRON_POLL_MAX_ERROR_RETRIES` transient RPC errors and caps total polls at
 * `TRON_POLL_MAX_POLLS`, since `waitForResult`'s maxRetries counts errors only.
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
