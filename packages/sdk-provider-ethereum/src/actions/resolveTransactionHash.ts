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
  // viem returns the wallet's answer to `eth_sendTransaction` unchecked, and
  // some wallets answer with `null` or another value that is not a hash.
  // Without a hash the transaction cannot be followed: the action keeps no
  // transaction, so a restart signs a new one. The wallet may still have sent
  // the first one, so the message tells the user to check the wallet first.
  // A transaction hash is 32 bytes (66 chars) and a Safe signature is longer.
  if (!isHex(txHashOrSignature) || txHashOrSignature.length < 66) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'The wallet did not return a transaction hash. Check the activity in your wallet before you try again, because the wallet may have sent the transaction.'
    )
  }

  const isSignature = await isSafeSignature(client, {
    hash: txHashOrSignature,
    chainId,
    address: viemClient.account?.address,
  })

  if (!isSignature) {
    return txHashOrSignature
  }

  const safeAddress = viemClient.account?.address
  if (!safeAddress) {
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
