import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { setAllowance } from '../actions/setAllowance.js'
import { MaxUint256 } from '../permits/constants.js'
import type { Call, EthereumStepExecutorContext } from '../types.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'

export class EthereumSetAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      client,
      statusManager,
      executionOptions,
      fromChain,
      isPermit2Supported,
      getExecutionStrategy,
      ethereumClient: updatedClient,
      shouldResetApproval,
      approvalResetTxHash,
    } = context

    const executionStrategy = await getExecutionStrategy(step)
    const batchingSupported = executionStrategy === 'batch'
    const permit2Supported = isPermit2Supported(batchingSupported)

    // Set new allowance
    const fromAmount = BigInt(step.action.fromAmount)
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount

    // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
    const spenderAddress = permit2Supported
      ? fromChain.permit2
      : step.estimate.approvalAddress

    const approveTxHash = await setAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      approveAmount,
      executionOptions,
      // We need to return the populated transaction is batching is supported
      // instead of executing transaction on-chain
      batchingSupported
    )

    // If batching is supported, we need to return the batch approval data
    // because allowance was't set by standard approval transaction
    if (batchingSupported) {
      statusManager.updateAction(step, action.type, 'DONE')

      // Check if the wallet supports atomic batch transactions (EIP-5792)
      const calls: Call[] = []

      // Add reset call first if approval reset is required
      if (shouldResetApproval && approvalResetTxHash) {
        calls.push({
          to: step.action.fromToken.address as Address,
          data: approvalResetTxHash,
          chainId: step.action.fromToken.chainId,
        })
      }

      // Add approval call
      calls.push({
        to: step.action.fromToken.address as Address,
        data: approveTxHash,
        chainId: step.action.fromToken.chainId,
      })

      context.calls.push(...calls)

      return { status: 'COMPLETED' }
    }

    await waitForApprovalTransaction(
      client,
      updatedClient,
      approveTxHash,
      action.type,
      step,
      fromChain,
      statusManager
    )

    return {
      status: 'COMPLETED',
    }
  }
}
