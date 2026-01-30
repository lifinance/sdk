import {
  type ExecutionAction,
  type ExtendedChain,
  type LiFiStepExtended,
  type SDKClient,
  type StatusManager,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import type { Client, Hash, TransactionReceipt } from 'viem'
import { isHex } from 'viem/utils'
import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { WalletCallReceipt } from '../../types.js'

export interface WaitForTransactionDeps {
  statusManager: StatusManager
  ethereumClient: Client
}

export async function waitForTransaction(
  client: SDKClient,
  params: {
    step: LiFiStepExtended
    action: ExecutionAction
    fromChain: ExtendedChain
    toChain: ExtendedChain
    isBridgeExecution: boolean
  },
  deps: WaitForTransactionDeps
): Promise<void> {
  const { step, action, fromChain, toChain, isBridgeExecution } = params
  const { statusManager, ethereumClient } = deps

  let currentAction = action
  const updateActionWithReceipt = (
    transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
  ) => {
    if (
      transactionReceipt?.transactionHash &&
      transactionReceipt.transactionHash !== currentAction.txHash
    ) {
      const txHash = isHex(transactionReceipt.transactionHash, {
        strict: true,
      })
        ? transactionReceipt.transactionHash
        : undefined
      currentAction = statusManager.updateAction(
        step,
        currentAction.type,
        'PENDING',
        {
          txHash,
          txLink:
            (transactionReceipt as WalletCallReceipt).transactionLink ||
            (txHash
              ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
              : undefined),
        }
      )
    }
  }

  let transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
  switch (currentAction.txType) {
    case 'batched':
      transactionReceipt = await waitForBatchTransactionReceipt(
        ethereumClient,
        currentAction.taskId as Hash,
        (result) => {
          const receipt = result.receipts?.find(
            (r) => r.status === 'reverted'
          ) as WalletCallReceipt | undefined
          if (receipt) {
            updateActionWithReceipt(receipt)
          }
        }
      )
      break
    case 'relayed':
      transactionReceipt = await waitForRelayedTransactionReceipt(
        client,
        currentAction.taskId as Hash,
        step
      )
      break
    default:
      transactionReceipt = await waitForTransactionReceipt(client, {
        client: ethereumClient,
        chainId: fromChain.id,
        txHash: currentAction.txHash as Hash,
        onReplaced: (response) => {
          statusManager.updateAction(step, currentAction.type, 'PENDING', {
            txHash: response.transaction.hash,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
          })
        },
      })
  }

  updateActionWithReceipt(transactionReceipt)

  if (isBridgeExecution) {
    currentAction = statusManager.updateAction(step, currentAction.type, 'DONE')
  }

  await waitForDestinationChainTransaction(
    client,
    step,
    currentAction,
    fromChain,
    toChain,
    statusManager
  )
}
