import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import type { RaceResult } from '../../confirmation/raceRpcs.js'

/** Only the nouns differ between the standard and bundle paths. */
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

/** `cause` is the first collected error on purpose: `BaseError` overwrites its
 * stack with `getRootCause(cause).stack`, and an `AggregateError` has no
 * `cause`, so without it the stack would point at this file. */
const chainErrors = (
  errors: Error[],
  message: string
): AggregateError | undefined =>
  errors.length
    ? new AggregateError(errors, message, { cause: errors[0] })
    : undefined

/**
 * Returns the confirmed value, or throws the error the integrator sees.
 *
 * Both wait tasks map the same three outcomes onto the same two error classes,
 * so the mapping lives here once. `rpc-unavailable` and `not-confirmed` must
 * stay distinct: collapsing them reported a live RPC defect as an expired
 * transaction.
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
