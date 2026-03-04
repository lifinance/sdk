import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { isSafeSignature } from './isSafeSignature.js'
import { waitForSafeTransactionExecution } from './waitForSafeTransactionExecution.js'

export const resolveTransactionHash = async (
  client: SDKClient,
  viemClient: Client,
  txHashOrSignature: Hash,
  chainId: number
) => {
  const isSignature = await isSafeSignature(client, {
    viemClient: viemClient,
    hash: txHashOrSignature,
    chainId,
    address: viemClient.account?.address,
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

  return await waitForSafeTransactionExecution(client, {
    chainId,
    safeAddress,
    signature: txHashOrSignature,
    pollingInterval: 5_000,
  })
}
