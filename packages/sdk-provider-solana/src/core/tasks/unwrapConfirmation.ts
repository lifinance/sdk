import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import type {
  RaceResult,
  UnconfirmedRaceResult,
} from '../../confirmation/raceRpcs.js'

/** Only the nouns differ between the standard and bundle paths. */
export type ConfirmationMessages = {
  /** Every branch failed: an outage, not a verdict about the transaction. */
  rpcUnavailable: string
  /** A branch polled to its deadline and saw nothing, or the blockhash
   * expired. Also the text of a final "dropped" verdict. */
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
 * The error the integrator sees for a result that did not confirm.
 *
 * `expired` maps exactly like `not-confirmed` - same code, same message - so
 * no text changes. The wait tasks tell the two apart by `result.kind` before
 * they call this: only they can run the history lookup and the status API a
 * final "dropped" needs, so the final marker is theirs to add.
 */
export function confirmationError(
  result: UnconfirmedRaceResult,
  messages: ConfirmationMessages
): RPCError | TransactionError {
  if (result.kind === 'rpc-unavailable') {
    return new RPCError(
      LiFiErrorCode.RpcUnavailable,
      messages.rpcUnavailable,
      chainErrors(result.errors, messages.allRpcsFailed)
    )
  }

  // The verdict came from branches that polled to their deadline or saw the
  // blockhash expire, but other branches may have died trying - and their
  // errors are the only trail explaining, say, an endpoint that never
  // answered.
  return new TransactionError(
    LiFiErrorCode.TransactionExpired,
    messages.notConfirmed,
    chainErrors(result.errors, messages.someRpcsFailed)
  )
}

/**
 * Returns the confirmed value, or throws the error the integrator sees.
 *
 * Both wait tasks map the same outcomes onto the same two error classes, so
 * the mapping lives here once. `rpc-unavailable` and `not-confirmed` must
 * stay distinct: collapsing them reported a live RPC defect as an expired
 * transaction.
 */
export function unwrapConfirmation<T>(
  result: RaceResult<T>,
  messages: ConfirmationMessages
): T {
  if (result.kind === 'confirmed') {
    return result.value
  }
  throw confirmationError(result, messages)
}
