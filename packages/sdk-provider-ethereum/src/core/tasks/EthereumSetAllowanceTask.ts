import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { Address } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { MaxUint256 } from '../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getTxLink } from './helpers/getTxLink.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumSetAllowanceTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_SET_ALLOWANCE' as const
  override readonly taskName = EthereumSetAllowanceTask.name

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { tasksResults } = context
    return (
      !tasksResults.hasMatchingPermit && !tasksResults.hasSufficientAllowance
    )
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      statusManager,
      executionOptions,
      fromChain,
      isFromNativeToken,
      disableMessageSigning,
      allowUserInteraction,
      checkClient,
      tasksResults,
    } = context

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const action = statusManager.findOrCreateAction({
      step,
      type: 'SET_ALLOWANCE',
      chainId: step.action.fromChainId,
    })

    // Clear the txHash and txLink from potential previous approval transaction
    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED', {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const executionStrategy = tasksResults.executionStrategy
    const batchingSupported = executionStrategy === 'batched'
    const permit2Supported = isPermit2Supported(
      step,
      fromChain,
      isFromNativeToken,
      disableMessageSigning,
      executionStrategy
    )

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
      // We need to return the populated transaction when batching is supported
      // instead of executing transaction on-chain
      batchingSupported
    )

    const calls = [...tasksResults.calls]
    if (batchingSupported) {
      calls.push({
        to: step.action.fromToken.address as Address,
        data: approveTxHash,
        chainId: step.action.fromToken.chainId,
      })
    }

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: approveTxHash,
      txLink: getTxLink(fromChain, approveTxHash),
    })

    return { status: 'COMPLETED', result: { calls } }
  }
}
