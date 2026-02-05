import {
  BaseStepExecutionTask,
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

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const action = context.getAction(
      context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
    return (
      !!action &&
      context.executionStrategy === 'standard' &&
      !!(action.txHash || action.taskId) &&
      action.status !== 'DONE'
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    let action = context.getOrCreateAction(
      context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )
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
    const updateActionWithReceipt = (
      transactionReceipt: TransactionReceipt | WalletCallReceipt | undefined
    ) => {
      if (
        transactionReceipt?.transactionHash &&
        transactionReceipt.transactionHash !== action.txHash
      ) {
        const txHash = isHex(transactionReceipt.transactionHash, {
          strict: true,
        })
          ? transactionReceipt.transactionHash
          : undefined
        action = statusManager.updateAction(step, action.type, 'PENDING', {
          txHash,
          txLink:
            (transactionReceipt as WalletCallReceipt).transactionLink ||
            (txHash
              ? `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`
              : undefined),
        })
      }
    }

    const transactionReceipt = await waitForTransactionReceipt(client, {
      client: ethereumClientToUse,
      chainId: fromChain.id,
      txHash: action.txHash as Hash,
      onReplaced: (response) => {
        action = statusManager.updateAction(step, action.type, 'PENDING', {
          txHash: response.transaction.hash,
          txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.hash}`,
        })
      },
    })

    updateActionWithReceipt(transactionReceipt)

    if (isBridgeExecution) {
      action = statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
