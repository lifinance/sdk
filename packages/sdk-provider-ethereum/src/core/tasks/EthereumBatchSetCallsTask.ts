import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import type { EthereumStepExecutorContext } from '../../types.js'

export class EthereumBatchSetCallsTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, statusManager } = context

    const resetTxHash = action.resetTxHash as Address
    const txHash = action.txHash as Address

    // Check if the wallet supports atomic batch transactions (EIP-5792)
    // If batching is supported, we need to return the batch approval data
    // because allowance was't set by standard approval transaction

    // Add reset allowance approval call
    if (resetTxHash) {
      context.calls.push({
        to: step.action.fromToken.address as Address,
        data: resetTxHash,
        chainId: step.action.fromToken.chainId,
      })
    }

    // Add approval call
    if (txHash) {
      context.calls.push({
        to: step.action.fromToken.address as Address,
        data: txHash,
        chainId: step.action.fromToken.chainId,
      })
    }

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
    }
  }
}
