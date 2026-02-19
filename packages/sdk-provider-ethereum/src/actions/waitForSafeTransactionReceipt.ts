import type { SDKClient } from '@lifi/sdk'
import type { Address, Client, TransactionReceipt } from 'viem'
import { waitForSafeTransactionExecution } from './waitForSafeTransactionExecution.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export interface WaitForSafeTransactionReceiptProps {
  viemClient: Client
  chainId: number
  safeAddress: Address
  signature: string
  pollingInterval?: number
}

/**
 * Polls the Safe Transaction Service until the transaction matching the given signature
 * is executed, then waits for the on-chain transaction to be confirmed.
 *
 * @param client - The SDK client.
 * @param props - {@link WaitForSafeTransactionReceiptProps}
 * @returns The on-chain transaction receipt, or undefined if the receipt has no status.
 * @throws {TransactionError} If the transaction fails, is reverted, cancelled, or replaced.
 */
export async function waitForSafeTransactionReceipt(
  client: SDKClient,
  {
    viemClient,
    chainId,
    safeAddress,
    signature,
    pollingInterval,
  }: WaitForSafeTransactionReceiptProps
): Promise<TransactionReceipt | undefined> {
  const resolvedTxHash = await waitForSafeTransactionExecution(client, {
    chainId,
    safeAddress,
    signature,
    pollingInterval,
  })

  // Wait for actual blockchain confirmation
  return await waitForTransactionReceipt(client, {
    client: viemClient,
    chainId,
    txHash: resolvedTxHash,
  })
}
