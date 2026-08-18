import type { Commitment } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'

type SignatureStatusesResponse = Awaited<
  ReturnType<ReturnType<SolanaRpcType['getSignatureStatuses']>['send']>
>

/**
 * One entry of a `getSignatureStatuses` response, derived from the RPC type
 * rather than hand-written.
 *
 * `sendAndConfirmTransaction` and `sendAndConfirmBundle` each used to carry
 * their own hand-rolled copy declaring `slot`, `confirmations` and `status`.
 * Nothing in the codebase ever read those three fields, and a hand-rolled type
 * that no test checks against the real response is exactly the drift this work
 * is removing. Deriving it also removes every `as SignatureStatus` cast.
 *
 * Verified: a `JitoRpcType` response assigns to this without a cast, because
 * `JitoRpcApi` includes `SolanaRpcApi`.
 */
export type SignatureStatus = NonNullable<
  SignatureStatusesResponse['value'][number]
>

/** What a single RPC branch is allowed to report. Failure is a throw. */
export type ConfirmationOutcome<T> =
  | { kind: 'confirmed'; value: T }
  | { kind: 'not-confirmed' }

export function isConfirmedCommitment(
  status: Commitment | string | null | undefined
): boolean {
  return status === 'confirmed' || status === 'finalized'
}
