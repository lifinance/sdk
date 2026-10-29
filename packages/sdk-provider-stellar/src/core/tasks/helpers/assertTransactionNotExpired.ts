import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { FeeBumpTransaction, TransactionBuilder } from '@stellar/stellar-sdk'

/** Check the final wallet payload without changing its prepared contents. */
export const assertTransactionNotExpired = (
  transactionXdr: string,
  networkPassphrase: string
): void => {
  const envelope = TransactionBuilder.fromXdr(transactionXdr, networkPassphrase)
  const transaction =
    envelope instanceof FeeBumpTransaction
      ? envelope.innerTransaction
      : envelope
  const maxTime = BigInt(transaction.timeBounds?.maxTime ?? '0')

  // Stellar's upper time bound is inclusive; zero means no time limit.
  // This local-clock check only avoids an already stale wallet prompt. It
  // cannot guarantee the envelope will still be valid when submitted.
  if (maxTime > 0n && maxTime < BigInt(Math.floor(Date.now() / 1000))) {
    throw new TransactionError(
      LiFiErrorCode.TransactionExpired,
      'The Stellar transaction expired before signing. Please resume the route to get a fresh transaction.'
    )
  }
}
