import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../../actions/getAllowance.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    return !context.hasMatchingPermit
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      checkClient,
      fromChain,
      client,
      statusManager,
      isFromNativeToken,
      disableMessageSigning,
      executionStrategy,
    } = context

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    // Start new allowance check
    const action = statusManager.initializeAction({
      step,
      type: 'CHECK_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

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

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: {
        hasAllowance: allowance > 0n,
        hasSufficientAllowance: fromAmount <= allowance,
      },
    }
  }
}
