import {
  BaseStepExecutionTask,
  type SignedTypedData,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getNativePermit } from '../../permits/getNativePermit.js'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getActionWithFallback } from '../../utils/getActionWithFallback.js'

export class EthereumNativePermitTask extends BaseStepExecutionTask {
  static override readonly name = 'ETHEREUM_NATIVE_PERMIT' as const
  override readonly taskName = EthereumNativePermitTask.name

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const { step, fromChain, disableMessageSigning, statusManager } = context

    const permitAction = statusManager.findAction(step, 'PERMIT')
    if (permitAction?.hasSignedPermit) {
      return false
    }

    const checkAllowanceAction = statusManager.findAction(
      step,
      'CHECK_ALLOWANCE'
    )
    if (checkAllowanceAction?.hasSufficientAllowance) {
      return false
    }

    const allowanceAction = statusManager.findAction(step, 'SET_ALLOWANCE')
    if (allowanceAction?.txHash) {
      return false
    }

    const executionStrategy = await context.getExecutionStrategy(step)
    const batchingSupported = executionStrategy === 'batched'
    // Check if proxy contract is available and message signing is not disabled, also not available for atomic batch
    const isNativePermitAvailable =
      !!fromChain.permit2Proxy &&
      !batchingSupported &&
      !disableMessageSigning &&
      !step.estimate.skipPermit
    return isNativePermitAvailable
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      fromChain,
      statusManager,
      allowUserInteraction,
      checkClient,
    } = context

    const action = statusManager.findOrCreateAction({
      step,
      type: 'NATIVE_PERMIT',
      chainId: step.action.fromChainId,
    })

    const updatedClient = await checkClient(step)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const fromAmount = BigInt(step.action.fromAmount)

    const nativePermitData = await getActionWithFallback(
      client,
      updatedClient,
      getNativePermit,
      'getNativePermit',
      {
        client,
        viemClient: updatedClient,
        chainId: fromChain.id,
        tokenAddress: step.action.fromToken.address as Address,
        spenderAddress: fromChain.permit2Proxy as Address,
        amount: fromAmount,
      }
    )

    if (!nativePermitData) {
      statusManager.updateAction(step, action.type, 'DONE')
      return { status: 'COMPLETED' }
    }

    let signedTypedData = context.signedTypedData
    if (!signedTypedData.length) {
      signedTypedData = action.signedTypedData || []
    }

    // Check if we already have a valid permit for this chain and requirements
    const signedTypedDataForChain = signedTypedData.find((signedTypedData) =>
      isNativePermitValid(signedTypedData, nativePermitData)
    )

    if (!signedTypedDataForChain) {
      statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

      if (!allowUserInteraction) {
        return { status: 'PAUSED' }
      }

      // Sign the permit
      const signature = await getAction(
        updatedClient,
        signTypedData,
        'signTypedData'
      )({
        account: updatedClient.account!,
        domain: nativePermitData.domain,
        types: nativePermitData.types,
        primaryType: nativePermitData.primaryType,
        message: nativePermitData.message,
      })

      // Add the new permit to the signed permits array
      const signedPermit: SignedTypedData = {
        ...nativePermitData,
        signature,
      }
      signedTypedData.push(signedPermit)
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      signedTypedData,
    })

    context.signedTypedData = signedTypedData

    return {
      status: 'COMPLETED',
    }
  }
}
