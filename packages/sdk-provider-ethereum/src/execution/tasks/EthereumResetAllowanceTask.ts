import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address, Hash } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'

export class EthereumResetAllowanceTask extends BaseStepExecutionTask {
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
      statusManager,
      allowUserInteraction,
      client,
      executionOptions,
      fromChain,
      ethereumClient: updatedClient,
      isFromNativeToken,
      disableMessageSigning,
      getExecutionStrategy,
    } = context

    const shouldResetApproval =
      step.estimate.approvalReset && (action.allowance ?? 0n) > 0n
    const resetApprovalStatus = shouldResetApproval
      ? 'RESET_REQUIRED'
      : 'ACTION_REQUIRED'

    // Clear the txHash and txLink from potential previous approval transaction
    statusManager.updateAction(step, action.type, resetApprovalStatus, {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const executionStrategy = await getExecutionStrategy(step)
    const batchingSupported = executionStrategy === 'batch'
    const permit2Supported = isPermit2Supported(
      step,
      fromChain,
      isFromNativeToken,
      disableMessageSigning,
      executionStrategy
    )
    const spenderAddress = permit2Supported
      ? fromChain.permit2
      : step.estimate.approvalAddress

    // Reset allowance to 0 if required
    let approvalResetTxHash: Hash | undefined
    if (shouldResetApproval) {
      approvalResetTxHash = await setAllowance(
        client,
        updatedClient,
        step.action.fromToken.address as Address,
        spenderAddress as Address,
        0n,
        executionOptions,
        batchingSupported
      )
      // Persist approval reset tx hash
      statusManager.updateAction(step, action.type, action.status, {
        approvalResetTxHash,
      })

      // If batching is NOT supported, wait for the reset transaction
      if (!batchingSupported) {
        await waitForApprovalTransaction(
          client,
          updatedClient,
          approvalResetTxHash,
          action.type,
          step,
          fromChain,
          statusManager
        )

        statusManager.updateAction(step, action.type, 'ACTION_REQUIRED', {
          txHash: undefined,
          txLink: undefined,
        })

        if (!allowUserInteraction) {
          return { status: 'PAUSED' }
        }
      }
    }

    return {
      status: 'COMPLETED',
    }
  }
}
