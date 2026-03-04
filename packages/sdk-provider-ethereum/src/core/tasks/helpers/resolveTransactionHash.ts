import { type ExtendedChain, LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { isSafeSignature } from '../../../actions/isSafeSignature.js'
import { waitForSafeTransactionExecution } from '../../../actions/waitForSafeTransactionExecution.js'

export const resolveTransactionHash = async (
  viemClient: Client,
  txHashOrSignature: Hash,
  fromChain: ExtendedChain,
  safeApiKey?: string
) => {
  // Check if the returned "hash" is actually a Safe signature
  // Safe wallets via Rabby return a signature (65 bytes = 132 chars) instead of a tx hash (32 bytes = 66 chars)
  const isSignature = await isSafeSignature({
    hash: txHashOrSignature,
    chainId: fromChain.id,
    address: viemClient.account?.address,
    viemClient: viemClient,
    safeApiKey,
  })

  if (!isSignature) {
    return txHashOrSignature
  }

  const safeAddress = viemClient.account?.address
  if (!safeAddress || !txHashOrSignature) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe address or signature not available for transaction tracking.'
    )
  }

  return await waitForSafeTransactionExecution({
    chainId: fromChain.id,
    safeAddress,
    signature: txHashOrSignature,
    safeApiKey,
    pollingInterval: 5_000,
  })
}
