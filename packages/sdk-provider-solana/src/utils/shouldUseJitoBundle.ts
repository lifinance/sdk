import { LiFiErrorCode, type RouteOptions, TransactionError } from '@lifi/sdk'
import type { Transaction } from '@solana/kit'

export const shouldUseJitoBundle = (
  routeOptions: RouteOptions | undefined,
  transactions: Transaction[]
): boolean => {
  const isJitoBundleEnabled = Boolean(routeOptions?.jitoBundle)

  if (transactions.length > 1 && !isJitoBundleEnabled) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      `Received ${transactions.length} transactions but Jito bundle is not enabled. Enable Jito bundle in routeOptions to submit multiple transactions.`
    )
  }

  return transactions.length > 1 && isJitoBundleEnabled
}
