import type {
  ExecutionAction,
  ExtendedChain,
  LiFiStepExtended,
  StatusManager,
} from '@lifi/sdk'
import type { TransactionReceipt } from 'viem'
import { isHex } from 'viem/utils'
import type { WalletCallReceipt } from '../../types.js'

/**
 * Update action to PENDING with txHash/txLink from a transaction receipt when the receipt hash differs from current action.
 * Returns the updated action or the same action if no update.
 */
export function updateActionWithReceipt(
  statusManager: StatusManager,
  step: LiFiStepExtended,
  fromChain: ExtendedChain,
  receipt: TransactionReceipt | WalletCallReceipt | undefined,
  action: ExecutionAction
): ExecutionAction {
  // Update pending action if the transaction hash from the receipt is different.
  // This might happen if the transaction was replaced or we used taskId instead of txHash.
  if (!receipt?.transactionHash || receipt.transactionHash === action.txHash) {
    return action
  }
  // Validate if transaction hash is a valid hex string that can be used on-chain
  // Some custom integrations may return non-hex identifiers to support custom status tracking
  const txHash = isHex(receipt.transactionHash, { strict: true })
    ? receipt.transactionHash
    : undefined
  return statusManager.updateAction(step, action.type, 'PENDING', {
    txHash,
    txLink:
      (receipt as WalletCallReceipt).transactionLink ||
      (txHash
        ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
        : undefined),
  })
}
