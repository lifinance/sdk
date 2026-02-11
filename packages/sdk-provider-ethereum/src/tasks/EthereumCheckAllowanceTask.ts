import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../actions/getAllowance.js'
import type { EthereumStepExecutorContext } from '../types.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask {
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
      checkClient,
      fromChain,
      client,
      statusManager,
      isPermit2Supported,
      getExecutionStrategy,
    } = context

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    // Start new allowance check
    statusManager.updateAction(step, action.type, 'STARTED')

    const executionStrategy = await getExecutionStrategy(step)
    const batchingSupported = executionStrategy === 'batch'
    // Check if chain has Permit2 contract deployed. Permit2 should not be available for atomic batch.
    const permit2Supported = isPermit2Supported(batchingSupported)
    const spenderAddress = permit2Supported
      ? fromChain.permit2
      : step.estimate.approvalAddress

    const fromAmount = BigInt(step.action.fromAmount)

    const allowance = await getAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      updatedClient.account!.address,
      spenderAddress as Address
    )
    // Persist allowance
    statusManager.updateAction(step, action.type, action.status, { allowance })

    // Return early if already approved
    if (fromAmount <= allowance) {
      statusManager.updateAction(step, action.type, 'DONE')
      return {
        status: 'COMPLETED',
      }
    }

    return {
      status: 'COMPLETED',
    }
  }
}
