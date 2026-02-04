import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import type { Hash, TransactionReceipt } from 'viem'
import { isHex } from 'viem/utils'
import { waitForBatchTransactionReceipt } from '../actions/waitForBatchTransactionReceipt.js'
import { waitForRelayedTransactionReceipt } from '../actions/waitForRelayedTransactionReceipt.js'
import { waitForTransactionReceipt } from '../actions/waitForTransactionReceipt.js'
import type { WalletCallReceipt } from '../types.js'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_WAIT_FOR_TRANSACTION'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !!(action.txHash || action.taskId) && action.status !== 'DONE'
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      action,
      fromChain,
      toChain,
      isBridgeExecution,
      statusManager,
      ethereumClient,
    } = context

    const updatedClient = await checkClientHelper(
      step,
      action,
      undefined,
      context.getClient,
      context.setClient,
      context.statusManager,
      context.allowUserInteraction,
      context.switchChain
    )
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const ethereumClientToUse = updatedClient ?? ethereumClient
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
          ethereumClientToUse,
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
          client: ethereumClientToUse,
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
      currentAction = statusManager.updateAction(
        step,
        currentAction.type,
        'DONE'
      )
    }

    await waitForDestinationChainTransaction(
      client,
      step,
      currentAction,
      fromChain,
      toChain,
      statusManager
    )

    return { status: 'COMPLETED' }
  }
}
