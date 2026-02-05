import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash, TransactionReceipt } from 'viem'
import { isHex } from 'viem/utils'
import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import type { WalletCallReceipt } from '../../types.js'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumBatchWaitForTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_BATCH_WAIT_FOR_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return (
      !!action &&
      context.executionStrategy === 'batch' &&
      !!(action.txHash || action.taskId) &&
      action.status !== 'DONE'
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<void>> {
    let currentAction = action
    const {
      step,
      fromChain,
      isBridgeExecution,
      statusManager,
      ethereumClient,
    } = context

    const updatedClient = await checkClientHelper(
      step,
      currentAction,
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
    const updateActionWithReceipt = (
      transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
    ) => {
      if (!currentAction) {
        return
      }
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

    const transactionReceipt = await waitForBatchTransactionReceipt(
      ethereumClientToUse,
      currentAction!.taskId as Hash,
      (result) => {
        const receipt = result.receipts?.find((r) => r.status === 'reverted') as
          | WalletCallReceipt
          | undefined
        if (receipt) {
          updateActionWithReceipt(receipt)
        }
      }
    )

    updateActionWithReceipt(transactionReceipt)

    if (isBridgeExecution) {
      currentAction = statusManager.updateAction(
        step,
        currentAction.type,
        'DONE'
      )
    }

    return { status: 'COMPLETED' }
  }
}
