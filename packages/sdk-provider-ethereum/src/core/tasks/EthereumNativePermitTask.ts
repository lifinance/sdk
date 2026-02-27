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
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'

export class EthereumNativePermitTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    const {
      step,
      fromChain,
      disableMessageSigning,
      hasMatchingPermit,
      hasSufficientAllowance,
    } = context

    if (hasMatchingPermit || hasSufficientAllowance) {
      return false
    }

    const executionStrategy = await getEthereumExecutionStrategy(context)
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
      signedTypedData: currentSignedTypedData,
    } = context

    const action = statusManager.initializeAction({
      step,
      type: 'NATIVE_PERMIT',
      chainId: step.action.fromChainId,
      status: 'STARTED',
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

    const signedTypedData = [...currentSignedTypedData]

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

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: { signedTypedData, hasMatchingPermit: true },
    }
  }
}
