import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { Address } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { waitForTransactionReceipt } from '../../actions/waitForTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getTxLink } from './helpers/getTxLink.js'
import { isPermit2Supported } from './helpers/isPermit2Supported.js'

export class EthereumResetAllowanceTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_RESET_ALLOWANCE' as const
  override readonly taskName = EthereumResetAllowanceTask.name

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, statusManager } = context

    const permitAction = statusManager.findAction(step, 'PERMIT')
    if (permitAction?.hasSignedPermit) {
      return false
    }

    const allowanceAction = statusManager.findAction(step, 'SET_ALLOWANCE')
    if (allowanceAction?.txHash) {
      return false
    }

    const checkAllowanceAction = statusManager.findAction(
      step,
      'CHECK_ALLOWANCE'
    )
    if (checkAllowanceAction?.hasSufficientAllowance) {
      return false
    }

    const nativePermitAction = statusManager.findAction(step, 'NATIVE_PERMIT')
    if (nativePermitAction?.signedTypedData) {
      return false
    }

    const shouldResetApproval =
      step.estimate.approvalReset && checkAllowanceAction?.hasAllowance
    return !!shouldResetApproval
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
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

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const action = statusManager.findOrCreateAction({
      step,
      type: 'RESET_ALLOWANCE',
      chainId: step.action.fromChainId,
      group: 'TOKEN_ALLOWANCE',
    })

    statusManager.updateAction(step, action.type, 'RESET_REQUIRED', {
      txHash: undefined,
      txLink: undefined,
    })

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const executionStrategy = await getExecutionStrategy(step)
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
      txHash: approvalResetTxHash,
      txLink: getTxLink(fromChain, approvalResetTxHash),
    })

    if (!batchingSupported) {
      const transactionReceipt = await waitForTransactionReceipt(client, {
        client: updatedClient,
        chainId: fromChain.id,
        txHash: approvalResetTxHash as Address,
        onReplaced(response) {
          const newHash = response.transaction.hash
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHash: newHash,
            txLink: getTxLink(fromChain, newHash),
          })
        },
      })
      const finalHash =
        transactionReceipt?.transactionHash || approvalResetTxHash
      statusManager.updateAction(step, action.type, action.status, {
        txHash: finalHash,
        txLink: getTxLink(fromChain, finalHash),
      })
    }

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
    }
  }
}
