import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../../actions/getAllowance.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumCheckAllowanceTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_CHECK_ALLOWANCE' as const
  override readonly taskName = EthereumCheckAllowanceTask.name

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, statusManager } = context
    const permitAction = statusManager.findAction(step, 'PERMIT')
    if (permitAction?.hasSignedPermit) {
      return false
    }
    const allowanceAction = statusManager.findAction(step, 'SET_ALLOWANCE')
    return !allowanceAction?.txHash
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
      outputs,
    } = context

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    // Start new allowance check
    const action = statusManager.findOrCreateAction({
      step,
      type: 'CHECK_ALLOWANCE',
      chainId: step.action.fromChainId,
      group: 'TOKEN_ALLOWANCE',
    })

    const executionStrategy = outputs.executionStrategy
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

    statusManager.updateAction(step, action.type, 'DONE', {
      hasAllowance: allowance > 0n,
      hasSufficientAllowance: fromAmount <= allowance,
    })

    return { status: 'COMPLETED' }
  }
}
