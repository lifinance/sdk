import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash, TransactionReceipt } from 'viem'
import { isHex } from 'viem/utils'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { WalletCallReceipt } from '../../types.js'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumStandardWaitForTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_STANDARD_WAIT_FOR_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return (
      !!action &&
      context.executionStrategy === 'standard' &&
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
      client,
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

    const transactionReceipt = await waitForTransactionReceipt(client, {
      client: ethereumClientToUse,
      chainId: fromChain.id,
      txHash: currentAction.txHash as Hash,
      onReplaced: (response) => {
        currentAction = statusManager.updateAction(
          step,
          currentAction.type,
          'PENDING',
          {
            txHash: response.transaction.hash,
            txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
          }
        )
      },
    })

    updateActionWithReceipt(transactionReceipt)

    if (isBridgeExecution) {
      statusManager.updateAction(step, currentAction.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
