import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import type { RaceResult } from '../../confirmation/raceRpcs.js'

/**
 * Wording for the two failure outcomes. The classification is fixed here; only
 * the nouns differ between the standard and the bundle path.
 */
export type ConfirmationMessages = {
  /** Every branch failed: an outage, not a verdict about the transaction. */
  rpcUnavailable: string
  /** A branch polled to its deadline and saw nothing. */
  notConfirmed: string
  /** Heading of the `AggregateError` chained onto `rpcUnavailable`. */
  allRpcsFailed: string
  /** Heading of the `AggregateError` chained onto `notConfirmed`. */
  someRpcsFailed: string
}

const chainErrors = (
  errors: Error[],
  message: string
): AggregateError | undefined =>
  errors.length ? new AggregateError(errors, message) : undefined

/**
 * Returns the confirmed value, or throws the error the integrator sees.
 *
 * Both wait tasks map the same three race outcomes onto the same two error
 * classes, differing only in wording, so the mapping lives here once. Keeping
 * it in one place is the point: before this rework the two paths classified
 * the same failures differently, and the bundle path delivered every one of
 * them as `UnknownError` with `InternalError`.
 *
 * `rpc-unavailable` and `not-confirmed` must stay distinct errors. Collapsing
 * them is what reported a live RPC-compatibility defect to users as an expired
 * transaction: no endpoint had answered at all, which says nothing about
 * whether the transaction landed.
 */
export function unwrapConfirmation<T>(
  result: RaceResult<T>,
  messages: ConfirmationMessages
): T {
  if (result.kind === 'rpc-unavailable') {
    throw new RPCError(
      LiFiErrorCode.RpcUnavailable,
      messages.rpcUnavailable,
      chainErrors(result.errors, messages.allRpcsFailed)
    )
  }

  if (result.kind === 'not-confirmed') {
    // The verdict came from a branch that polled to its deadline and saw
    // nothing, but other branches may have died trying - and their errors are
    // the only trail explaining, say, an endpoint that never answered.
    throw new TransactionError(
      LiFiErrorCode.TransactionExpired,
      messages.notConfirmed,
      chainErrors(result.errors, messages.someRpcsFailed)
    )
  }

  return result.value
}
