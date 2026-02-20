import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getTxLink } from './helpers/getTxLink.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumResetAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    const { step } = context
    const shouldResetApproval =
      step.estimate.approvalReset && action.allowanceApproved
    return context.isTransactionPrepared(action) && shouldResetApproval
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      getExecutionStrategy,
      checkClient,
      fromChain,
      isFromNativeToken,
      disableMessageSigning,
      executionOptions,
      client,
    } = context

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'ACTION_REQUIRED' }
    }

    if (!allowUserInteraction) {
      return { status: 'ACTION_REQUIRED' }
    }

    // Clear the txHash and txLink from potential previous reset allowance approval transaction
    statusManager.updateAction(step, action.type, 'RESET_REQUIRED', {
      resetTxHash: undefined,
      resetTxLink: undefined,
    })

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
    const approvalResetTxHash = await setAllowance(
      client,
      updatedClient,
      step.action.fromToken.address as Address,
      spenderAddress as Address,
      0n,
      executionOptions,
      batchingSupported
    )

    statusManager.updateAction(step, action.type, 'PENDING', {
      resetTxHash: approvalResetTxHash,
      resetTxLink: getTxLink(fromChain, approvalResetTxHash),
    })

    if (!batchingSupported) {
      const transactionReceipt = await waitForTransactionReceipt(client, {
        client: updatedClient,
        chainId: fromChain.id,
        txHash: action.resetTxHash as Address,
        onReplaced(response) {
          const newHash = response.transaction.hash
          statusManager.updateAction(step, action.type, 'PENDING', {
            resetTxHash: newHash,
            resetTxLink: getTxLink(fromChain, newHash),
          })
        },
      })
      const finalHash =
        transactionReceipt?.transactionHash || approvalResetTxHash
      statusManager.updateAction(step, action.type, action.status, {
        resetTxHash: finalHash,
        resetTxLink: getTxLink(fromChain, finalHash),
      })
    }

    return {
      status: 'COMPLETED',
    }
  }
}
