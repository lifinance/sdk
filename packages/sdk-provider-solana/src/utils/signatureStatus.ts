import type { Commitment, TransactionError } from '@solana/kit'

export type SignatureStatus = {
  slot: bigint
  confirmations: bigint | null
  err: TransactionError | null
  confirmationStatus: Commitment | null
  status: Readonly<{ Err: TransactionError }> | Readonly<{ Ok: null }>
}

export function isConfirmedCommitment(
  commitment: string | null | undefined
): boolean {
  return commitment === 'confirmed' || commitment === 'finalized'
}

export function getConfirmedStatus(
  statusResponse: Readonly<{
    value: readonly (SignatureStatus | null)[]
  }>
): SignatureStatus | null {
  const status = statusResponse.value[0]
  if (status && isConfirmedCommitment(status.confirmationStatus)) {
    return status
  }
  return null
}
