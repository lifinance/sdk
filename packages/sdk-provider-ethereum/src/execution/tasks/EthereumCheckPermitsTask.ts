import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskResult,
} from '@lifi/sdk'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getDomainChainId } from '../../utils/getDomainChainId.js'

export class EthereumCheckPermitsTask extends BaseStepExecutionTask {
  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, statusManager, allowUserInteraction, checkClient } = context

    // First, try to sign all permits in step.typedData
    const permitTypedData =
      step.typedData?.filter(
        (typedData) => typedData.primaryType === 'Permit'
      ) ?? []

    const signedTypedData = action.signedTypedData ?? []
    for (const typedData of permitTypedData) {
      // Check if we already have a valid permit for this chain and requirements
      const signedTypedDataForChain = signedTypedData.find(
        (signedTypedData: SignedTypedData) =>
          isNativePermitValid(signedTypedData, typedData)
      )

      if (signedTypedDataForChain) {
        // Skip signing if we already have a valid permit
        continue
      }

      statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')
      if (!allowUserInteraction) {
        return { status: 'PAUSED' }
      }

      const typedDataChainId =
        getDomainChainId(typedData.domain) || step.action.fromChainId
      // Switch to the permit's chain if needed
      const permitClient = await checkClient(step, action, typedDataChainId)
      if (!permitClient) {
        return { status: 'PAUSED' }
      }

      const signature = await getAction(
        permitClient,
        signTypedData,
        'signTypedData'
      )({
        account: permitClient.account!,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
      const signedPermit: SignedTypedData = {
        ...typedData,
        signature,
      }
      signedTypedData.push(signedPermit)
      statusManager.updateAction(step, action.type, 'ACTION_REQUIRED', {
        signedTypedData,
      })
    }

    statusManager.updateAction(step, action.type, 'DONE', {
      signedTypedData,
    })

    context.signedTypedData = signedTypedData

    return { status: 'COMPLETED' }
  }
}
