import type { ChainId } from '@lifi/types'
import type {
  Chain,
  Client,
  Hash,
  ReplacementReason,
  ReplacementReturnType,
  TransactionReceipt,
} from 'viem'
import { waitForTransactionReceipt as waitForTransactionReceiptInternal } from 'viem/actions'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getPublicClient } from './publicClient.js'
import { retryCount, retryDelay } from './utils.js'

interface WaitForTransactionReceiptProps {
  client: Client
  chainId: ChainId
  txHash: Hash
  onReplaced?: (response: ReplacementReturnType<Chain | undefined>) => void
}

export async function waitForTransactionReceipt({
  client,
  chainId,
  txHash,
  onReplaced,
}: WaitForTransactionReceiptProps): Promise<TransactionReceipt | undefined> {
  let { transactionReceipt, replacementReason } = await waitForReceipt(
    client,
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
  client: Client,
  txHash: Hash,
  onReplaced?: (response: ReplacementReturnType<Chain | undefined>) => void
): Promise<{
  transactionReceipt?: TransactionReceipt
  replacementReason?: ReplacementReason
}> {
  let replacementReason: ReplacementReason | undefined
  let transactionReceipt: TransactionReceipt | undefined

  try {
    transactionReceipt = await waitForTransactionReceiptInternal(client, {
      hash: txHash,
      onReplaced: (response) => {
        replacementReason = response.reason
        onReplaced?.(response)
      },
      retryCount,
      retryDelay,
    })
  } catch {
    // We can ignore errors from waitForTransactionReceipt as we have a status check fallback
  }

  return { transactionReceipt, replacementReason }
}
