import type { ChainId } from '@lifi/types'
import type {
  Chain,
  Hash,
  PublicClient,
  ReplacementReason,
  ReplacementReturnType,
  TransactionReceipt,
  WalletClient,
} from 'viem'
import { publicActions } from 'viem'
import { LiFiErrorCode, TransactionError } from '../../utils/index.js'
import { getPublicClient } from './publicClient.js'
import { retryCount, retryDelay } from './utils.js'

interface WaitForTransactionReceiptProps {
  walletClient: WalletClient
  chainId: ChainId
  txHash: Hash
  onReplaced?: (response: ReplacementReturnType<Chain | undefined>) => void
}

export async function waitForTransactionReceipt({
  walletClient,
  chainId,
  txHash,
  onReplaced,
}: WaitForTransactionReceiptProps): Promise<TransactionReceipt | undefined> {
  let { transactionReceipt, replacementReason } = await waitForReceipt(
    walletClient.extend(publicActions),
    txHash,
    onReplaced
  )

  if (!transactionReceipt?.status) {
    const publicClient = await getPublicClient(chainId)
    const result = await waitForReceipt(publicClient, txHash, onReplaced)
    transactionReceipt = result.transactionReceipt
    replacementReason = result.replacementReason
  }

  if (transactionReceipt?.status === 'reverted') {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction was reverted.'
    )
  }
  if (replacementReason === 'cancelled') {
    throw new TransactionError(
      LiFiErrorCode.TransactionCanceled,
      'User canceled transaction.'
    )
  }

  return transactionReceipt
}

async function waitForReceipt(
  client: PublicClient | WalletClient,
  txHash: Hash,
  onReplaced?: (response: ReplacementReturnType<Chain | undefined>) => void
): Promise<{
  transactionReceipt?: TransactionReceipt
  replacementReason?: ReplacementReason
}> {
  let replacementReason: ReplacementReason | undefined
  let transactionReceipt: TransactionReceipt | undefined

  try {
    transactionReceipt = await (
      client as PublicClient
    ).waitForTransactionReceipt({
      hash: txHash,
      onReplaced: (response) => {
        replacementReason = response.reason
        onReplaced?.(response)
      },
      retryCount,
      retryDelay,
    })
  } catch (error) {
    // We can ignore errors from waitForTransactionReceipt as we have a status check fallback
  }

  return { transactionReceipt, replacementReason }
}
