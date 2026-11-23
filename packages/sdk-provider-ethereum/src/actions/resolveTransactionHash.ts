import { LiFiErrorCode, type SDKClient, TransactionError } from '@lifi/sdk'
import { type Client, type Hash, isHex } from 'viem'
import { isSafeSignature } from './isSafeSignature.js'
import { waitForSafeTransactionExecution } from './waitForSafeTransactionExecution.js'

export const resolveTransactionHash = async (
  client: SDKClient,
  viemClient: Client,
  txHashOrSignature: Hash,
  chainId: number
): Promise<Hash> => {
  const isSignature = await isSafeSignature(client, {
    hash: txHashOrSignature,
    chainId,
    address: viemClient.account?.address,
  })

  if (!isSignature) {
    // Unchecked wallet answer; longer hex can be a Safe signature the lookup missed.
    if (!isHex(txHashOrSignature) || txHashOrSignature.length < 66) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'The wallet did not return a transaction hash. The wallet may have sent the transaction. Before you try again, check the activity in your wallet.'
      )
    }
    return txHashOrSignature
  }

  const safeAddress = viemClient.account?.address
  if (!safeAddress) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe address not available for transaction tracking.'
    )
  }

  return await waitForSafeTransactionExecution(client, {
    chainId,
    safeAddress,
    signature: txHashOrSignature,
    pollingInterval: 5_000,
  })
}
