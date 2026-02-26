import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { Address } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getTxLink } from './helpers/getTxLink.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumResetAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, hasMatchingPermit, hasSufficientAllowance, hasAllowance } =
      context

    return (
      !hasMatchingPermit &&
      !hasSufficientAllowance &&
      !!step.estimate.approvalReset &&
      !!hasAllowance
    )
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      checkClient,
      fromChain,
      isFromNativeToken,
      disableMessageSigning,
      executionOptions,
      client,
      executionStrategy,
      calls: currentCalls,
    } = context

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const action = statusManager.initializeAction({
      step,
      type: 'RESET_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    statusManager.updateAction(step, action.type, 'RESET_REQUIRED', {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const batchingSupported = executionStrategy === 'batched'

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
    const resetResult = await setAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      0n,
      executionOptions,
      batchingSupported
    )

    const calls = [...currentCalls]
    if (batchingSupported) {
      calls.push({
        to: step.action.fromToken.address as Address,
        data: resetResult,
        chainId: step.action.fromToken.chainId,
      })
    } else {
      statusManager.updateAction(step, action.type, 'PENDING', {
        txHash: resetResult,
        txLink: getTxLink(fromChain, resetResult),
      })

      const transactionReceipt = await waitForTransactionReceipt(client, {
        client: updatedClient,
        chainId: fromChain.id,
        txHash: resetResult as Address,
        onReplaced(response) {
          const newHash = response.transaction.hash
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHash: newHash,
            txLink: getTxLink(fromChain, newHash),
          })
        },
      })
      const finalHash = transactionReceipt?.transactionHash || resetResult
      statusManager.updateAction(step, action.type, action.status, {
        txHash: finalHash,
        txLink: getTxLink(fromChain, finalHash),
      })
    }

    statusManager.updateAction(step, action.type, 'DONE')

    return { status: 'COMPLETED', context: { calls } }
  }
}
