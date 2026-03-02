import {
  type ExtendedChain,
  LiFiErrorCode,
  type SDKClient,
  TransactionError,
  type TransactionMethodType,
} from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { isSafeSignature } from '../../../actions/isSafeSignature.js'
import { waitForSafeTransactionExecution } from '../../../actions/waitForSafeTransactionExecution.js'
import { getTxLink } from './getTxLink.js'

export const getActionTransactionData = async (
  client: SDKClient,
  viemClient: Client,
  txHashOrSignature: Hash,
  fromChain: ExtendedChain
) => {
  // Check if the returned "hash" is actually a Safe signature
  // Safe wallets via Rabby return a signature (65 bytes = 132 chars) instead of a tx hash (32 bytes = 66 chars)
  const isSignature = await isSafeSignature(client, {
    hash: txHashOrSignature,
    chainId: fromChain.id,
    address: viemClient.account?.address,
    viemClient: viemClient,
  })

  let txHash = txHashOrSignature as Hash
  if (isSignature) {
    const safeAddress = viemClient.account?.address
    if (!safeAddress || !txHashOrSignature) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Safe address or signature not available for transaction tracking.'
      )
    }
    txHash = await waitForSafeTransactionExecution(client, {
      chainId: fromChain.id,
      safeAddress,
      signature: txHashOrSignature,
      pollingInterval: 5_000,
    })

    return {
      txHash,
      txType: 'safe-queued' as TransactionMethodType,
      txLink: txHash ? getTxLink(fromChain, txHash) : undefined,
    }
  }

  return {
    txHash,
    txType: 'standard' as TransactionMethodType,
    txLink: txHash ? getTxLink(fromChain, txHash) : undefined,
  }
}
