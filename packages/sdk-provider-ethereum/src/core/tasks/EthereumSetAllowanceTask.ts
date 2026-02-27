import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { Address } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import { MaxUint256 } from '../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'
import { getTxLink } from './helpers/getTxLink.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumSetAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    return !context.hasMatchingPermit && !context.hasSufficientAllowance
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
      calls: currentCalls,
    } = context

    const action = statusManager.initializeAction({
      step,
      type: 'SET_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    // Clear the txHash and txLink from potential previous approval transaction
    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED', {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const executionStrategy = await getEthereumExecutionStrategy(context)
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

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const approveResult = await setAllowance(
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

    const calls = [...currentCalls]
    if (batchingSupported) {
      calls.push({
        to: step.action.fromToken.address as Address,
        data: approveResult,
        chainId: step.action.fromToken.chainId,
      })

      statusManager.updateAction(step, action.type, 'DONE')
    } else {
      statusManager.updateAction(step, action.type, 'PENDING', {
        txHash: approveResult,
        txLink: getTxLink(fromChain, approveResult),
      })

      const transactionReceipt = await waitForTransactionReceipt(client, {
        client: updatedClient,
        chainId: fromChain.id,
        txHash: approveResult,
        onReplaced(response) {
          const newHash = response.transaction.hash
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHash: newHash,
            txLink: getTxLink(fromChain, newHash),
          })
        },
      })

      const finalHash = transactionReceipt?.transactionHash || approveResult
      statusManager.updateAction(step, action.type, 'DONE', {
        txHash: finalHash,
        txLink: getTxLink(fromChain, finalHash),
      })
    }

    return { status: 'COMPLETED', context: { calls, executionStrategy } }
  }
}
