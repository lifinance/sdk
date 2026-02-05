import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash, TransactionReceipt } from 'viem'
import { isHex } from 'viem/utils'
import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import type { WalletCallReceipt } from '../../types.js'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumRelayerWaitForTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_RELAYER_WAIT_FOR_TRANSACTION'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const action = context.getAction(
      context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    return (
      !!action &&
      context.executionStrategy === 'relayer' &&
      !!(action.txHash || action.taskId) &&
      action.status !== 'DONE'
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const actionType = context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    let currentAction = context.getOrCreateAction(actionType)
    if (!currentAction) {
      throw new Error(`Action not found for type ${actionType}`)
    }
    const { client, step, fromChain, isBridgeExecution, statusManager } =
      context

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

    const transactionReceipt = await waitForRelayedTransactionReceipt(
      client,
      currentAction!.taskId as Hash,
      step
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
