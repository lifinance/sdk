import type { Commitment } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'

type SignatureStatusesResponse = Awaited<
  ReturnType<ReturnType<SolanaRpcType['getSignatureStatuses']>['send']>
>

/** Derived from the RPC type rather than hand-written, which removes every
 * `as SignatureStatus` cast. A `JitoRpcType` response assigns without one. */
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
