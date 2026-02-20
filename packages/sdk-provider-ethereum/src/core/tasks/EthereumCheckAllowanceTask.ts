import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../../actions/getAllowance.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionPrepared(action)
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
      getExecutionStrategy,
      isFromNativeToken,
      disableMessageSigning,
    } = context

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Start new allowance check
    statusManager.updateAction(step, action.type, 'STARTED')

    const executionStrategy = await getExecutionStrategy(step)
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

    const fromAmount = BigInt(step.action.fromAmount)

    const allowance = await getAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      updatedClient.account!.address,
      spenderAddress as Address
    )

    // Persist allowance approved status
    statusManager.updateAction(step, action.type, action.status, {
      allowanceApproved: allowance > 0n,
    })

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
