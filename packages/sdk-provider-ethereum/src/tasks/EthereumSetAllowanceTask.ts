import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskResult,
} from '@lifi/sdk'
import type { Address, Client, Hash } from 'viem'
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
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      updatedClient: Client
      spenderAddress: Address
      batchingSupported: boolean
      shouldResetApproval: boolean
      approvalResetTxHash: Hash
    }
  ): Promise<TaskResult> {
    const {
      step,
      client,
      statusManager,
      executionOptions,
      fromChain,
      isPermit2Supported,
    } = context
    const {
      signedTypedData,
      updatedClient,
      spenderAddress,
      batchingSupported,
      shouldResetApproval,
      approvalResetTxHash,
    } = payload

    // Set new allowance
    const fromAmount = BigInt(step.action.fromAmount)
    const approveAmount = isPermit2Supported(batchingSupported)
      ? MaxUint256
      : fromAmount
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

      return {
        status: 'COMPLETED',
        data: {
          signedTypedData,
          calls,
        },
      }
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
      data: {
        signedTypedData,
      },
    }
  }
}
